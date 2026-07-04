import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import yaml from "js-yaml";

import { seedBuiltinRulesetCatalog } from "../src/lib/db/seed-ruleset-catalog";
import {
  RECOMMENDED_TEMPLATE_ID,
  seedBuiltinTemplates
} from "../src/lib/db/seed-builtin-templates";
import { SecretBox } from "../src/lib/security/secret-box";
import { Scheduler } from "../src/lib/scheduler/scheduler";
import { extractTemplate, instantiateTemplate } from "../src/lib/build-config/template";
import { EventRepository } from "../src/modules/events/event.repository";
import { RulesetRepository } from "../src/modules/rulesets/ruleset.repository";
import { RulesetService } from "../src/modules/rulesets/ruleset.service";
import { SecretStore } from "../src/modules/subscriptions/secret-store";
import { SubscriptionRepository } from "../src/modules/subscriptions/subscription.repository";
import {
  SubscriptionError,
  SubscriptionService
} from "../src/modules/subscriptions/subscription.service";
import { TemplateRepository } from "../src/modules/templates/template.repository";
import { UpstreamSourceRepository } from "../src/modules/upstream-sources/upstream-source.repository";
import { UpstreamSourceService } from "../src/modules/upstream-sources/upstream-source.service";
import type { ClashProxyDocument } from "../src/types";

const migrationsDir = resolve(import.meta.dir, "../migrations");

const applyMigrations = (db: Database) => {
  for (const fileName of readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(resolve(migrationsDir, fileName), "utf-8"));
  }
};

const createUser = (db: Database, name: string) => {
  const id = `user_${name}`;
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO users (id, email, username, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, `${name}@test.local`, name, name, now, now);
  return id;
};

const sourceYaml = (nodes: Array<Record<string, unknown>>) =>
  yaml.dump({
    proxies: nodes,
    "proxy-groups": [{ name: "Proxy", type: "select", proxies: [nodes[0]?.name ?? "DIRECT"] }],
    rules: ["MATCH,Proxy"]
  });

const defaultNodes = [
  { name: "HK-01", type: "ss", server: "hk1.test", port: 443, cipher: "aes-128-gcm", password: "a" },
  { name: "US-01", type: "ss", server: "us1.test", port: 443, cipher: "aes-128-gcm", password: "b" },
  { name: "神秘节点", type: "ss", server: "x1.test", port: 443, cipher: "aes-128-gcm", password: "c" }
];

const createTestContext = (options: { mihomo?: boolean } = {}) => {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  applyMigrations(db);
  seedBuiltinRulesetCatalog(db);
  seedBuiltinTemplates(db);

  const events = new EventRepository(db);
  const sourceRepository = new UpstreamSourceRepository(db);
  const sourceService = new UpstreamSourceService(sourceRepository, events);
  const rulesetRepository = new RulesetRepository(db);
  const rulesetService = new RulesetService(rulesetRepository, events);
  const templateRepository = new TemplateRepository(db);
  const subscriptionRepository = new SubscriptionRepository(db);
  const secretStore = new SecretStore(db, new SecretBox(randomBytes(32)));
  const backendDataDir = resolve(import.meta.dir, "..", "data");
  const subscriptionService = new SubscriptionService(
    subscriptionRepository,
    sourceRepository,
    rulesetRepository,
    templateRepository,
    events,
    secretStore,
    {
      publicBaseUrl: "https://pp.test",
      mihomo: options.mihomo
        ? {
            mihomoPath: null,
            dataDir: backendDataDir,
            assetsDir: resolve(import.meta.dir, "..", "assets")
          }
        : { mihomoPath: null, dataDir: "/nonexistent-dir", assetsDir: "/nonexistent-dir" }
    }
  );
  sourceService.registerOnSynced((source, report) =>
    subscriptionService.onSourceSynced(source, report)
  );

  const userId = createUser(db, "alice");
  const source = sourceService.createFromUpload(userId, {
    displayName: "白云机场",
    yamlContent: sourceYaml(defaultNodes)
  });

  return {
    db,
    events,
    sourceRepository,
    sourceService,
    rulesetRepository,
    rulesetService,
    templateRepository,
    subscriptionRepository,
    subscriptionService,
    secretStore,
    userId,
    source
  };
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// ── 创建与发布管线 ────────────────────────────────────────────

describe("发布管线", () => {
  test("推荐方案创建 → 发布 → 版本 v1 → 链接可拉取", () => {
    const ctx = createTestContext();
    const { subscription, token } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "日常",
      sourceIds: [ctx.source.id],
      start: { kind: "recommended" }
    });
    expect(subscription.hasDraft).toBe(true);
    expect(token.url).toContain(`/s/${subscription.id}/`);

    const release = ctx.subscriptionService.publish(ctx.userId, subscription.id, {
      trigger: "manual"
    });
    expect(release.seq).toBe(1);

    const delivered = ctx.subscriptionService.deliver(
      subscription.id,
      token.token,
      "token",
      "127.0.0.1",
      "clash-verge/test"
    );
    const doc = yaml.load(delivered.yamlText) as ClashProxyDocument;
    expect(doc.proxies.map((p) => p.name)).toEqual(
      expect.arrayContaining(["HK-01", "US-01"])
    );
    const groupNames = doc["proxy-groups"].map((g) => g.name);
    expect(groupNames).toEqual(expect.arrayContaining(["Proxies", "AI", "Streaming", "HK", "US"]));
    expect(doc.rules?.[doc.rules.length - 1]).toBe("MATCH,Proxies");
    // 规则快照以不可变哈希端点输出
    const providers = doc["rule-providers"] as Record<string, { url: string }>;
    expect(Object.values(providers).every((p) => p.url.startsWith("https://pp.test/rs/"))).toBe(
      true
    );
    // 发布后健康转绿
    expect(ctx.subscriptionRepository.findById(subscription.id)!.health).toBe("ok");
  });

  test("拉取零上游请求：断网状态下 deliver 正常", () => {
    const ctx = createTestContext();
    const { subscription, token } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "日常",
      sourceIds: [ctx.source.id],
      start: { kind: "recommended" }
    });
    ctx.subscriptionService.publish(ctx.userId, subscription.id, { trigger: "manual" });

    globalThis.fetch = (() => {
      throw new Error("network disabled");
    }) as unknown as typeof fetch;

    const delivered = ctx.subscriptionService.deliver(
      subscription.id,
      token.token,
      "token",
      null,
      null
    );
    expect(delivered.yamlText.length).toBeGreaterThan(100);
  });

  test("悬空引用阻断发布并进入问题清单", () => {
    const ctx = createTestContext();
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "坏配置",
      sourceIds: [ctx.source.id],
      start: { kind: "blank" }
    });
    const record = ctx.subscriptionRepository.findById(subscription.id)!;
    const draft = structuredClone(record.draftBuildConfig!);
    draft.groups.custom.push({
      name: "AI",
      type: "select",
      members: [{ kind: "node", nodeId: "n_000000000000" }]
    });
    ctx.subscriptionService.saveDraft(ctx.userId, subscription.id, draft);

    expect(() =>
      ctx.subscriptionService.publish(ctx.userId, subscription.id, { trigger: "manual" })
    ).toThrow(SubscriptionError);

    const issues = ctx.subscriptionRepository.listOpenIssues(subscription.id);
    expect(issues.some((issue) => issue.kind === "dangling-node-ref")).toBe(true);
    expect(ctx.subscriptionRepository.findById(subscription.id)!.health).not.toBe("ok");
  });

  test("回滚生成新版本且内容与目标版本一致", () => {
    const ctx = createTestContext();
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "日常",
      sourceIds: [ctx.source.id],
      start: { kind: "recommended" }
    });
    const v1 = ctx.subscriptionService.publish(ctx.userId, subscription.id, { trigger: "manual" });

    // 修改草稿再发布 v2
    const record = ctx.subscriptionRepository.findById(subscription.id)!;
    const draft = structuredClone(record.buildConfig!);
    draft.config.structured.logLevel = "debug";
    ctx.subscriptionService.saveDraft(ctx.userId, subscription.id, draft);
    const v2 = ctx.subscriptionService.publish(ctx.userId, subscription.id, { trigger: "manual" });
    expect(v2.seq).toBe(2);
    expect(v2.renderedHash).not.toBe(v1.renderedHash);

    const v3 = ctx.subscriptionService.rollback(ctx.userId, subscription.id, v1.id);
    expect(v3.seq).toBe(3);
    expect(v3.renderedHash).toBe(v1.renderedHash);
    expect(ctx.subscriptionRepository.findById(subscription.id)!.activeReleaseId).toBe(v3.id);
  });

  test("mihomo 门禁（本机有内核时）：正常配置通过", () => {
    const mihomoPath = resolve(import.meta.dir, "..", "data", "bin", "mihomo");
    if (!existsSync(mihomoPath)) {
      return; // 无内核环境跳过（降级路径由 available=false 覆盖）
    }
    const ctx = createTestContext({ mihomo: true });
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "门禁",
      sourceIds: [ctx.source.id],
      start: { kind: "recommended" }
    });
    const release = ctx.subscriptionService.publish(ctx.userId, subscription.id, {
      trigger: "manual"
    });
    expect(release.validation.mihomo?.available).toBe(true);
    expect(release.validation.mihomo?.passed).toBe(true);
  });
});

// ── Token 与访问 ─────────────────────────────────────────────

describe("Token", () => {
  test("轮换后旧 token 失效、新 token 可用", () => {
    const ctx = createTestContext();
    const { subscription, token } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "日常",
      sourceIds: [ctx.source.id],
      start: { kind: "recommended" }
    });
    ctx.subscriptionService.publish(ctx.userId, subscription.id, { trigger: "manual" });

    const rotated = ctx.subscriptionService.rotateToken(ctx.userId, subscription.id, token.id);
    expect(() =>
      ctx.subscriptionService.deliver(subscription.id, token.token, "token", null, null)
    ).toThrow("无效或已撤销");
    const delivered = ctx.subscriptionService.deliver(
      subscription.id,
      rotated.token,
      "token",
      null,
      null
    );
    expect(delivered.yamlText.length).toBeGreaterThan(0);
  });

  test("短期链接 TTL 边界与撤销", () => {
    const ctx = createTestContext();
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "日常",
      sourceIds: [ctx.source.id],
      start: { kind: "recommended" }
    });
    ctx.subscriptionService.publish(ctx.userId, subscription.id, { trigger: "manual" });

    expect(() =>
      ctx.subscriptionService.createTempToken(ctx.userId, subscription.id, {
        label: null,
        ttlSeconds: 60
      })
    ).toThrow("1 小时到 30 天");

    const temp = ctx.subscriptionService.createTempToken(ctx.userId, subscription.id, {
      label: "给朋友",
      ttlSeconds: 3600
    });
    const delivered = ctx.subscriptionService.deliver(
      subscription.id,
      temp.token,
      "temp_token",
      null,
      null
    );
    expect(delivered.yamlText.length).toBeGreaterThan(0);

    ctx.subscriptionService.revokeTempToken(ctx.userId, subscription.id, temp.id);
    expect(() =>
      ctx.subscriptionService.deliver(subscription.id, temp.token, "temp_token", null, null)
    ).toThrow("无效或已撤销");
  });
});

// ── 上游变化吸收与调度器 ───────────────────────────────────────

describe("上游吸收", () => {
  test("URL 源同步 → 报告 → auto 策略自动发布新版本", async () => {
    const ctx = createTestContext();

    let servedNodes = defaultNodes;
    globalThis.fetch = (async () =>
      new Response(sourceYaml(servedNodes), {
        status: 200,
        headers: { "subscription-userinfo": "upload=1; download=2; total=100; expire=9999999999" }
      })) as unknown as typeof fetch;

    const urlSource = await ctx.sourceService.create(ctx.userId, {
      displayName: "机场B",
      sourceUrl: "https://airport.test/sub"
    });
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "自动",
      sourceIds: [urlSource.id],
      start: { kind: "recommended" }
    });
    const v1 = ctx.subscriptionService.publish(ctx.userId, subscription.id, {
      trigger: "manual"
    });

    // 上游变化：新增节点 + 改名
    servedNodes = [
      { ...defaultNodes[0]!, name: "HK-Prime" },
      ...defaultNodes.slice(1),
      { name: "SG-01", type: "ss", server: "sg1.test", port: 443, cipher: "aes-128-gcm", password: "d" }
    ];
    // 置为到期并驱动一轮调度
    ctx.db.query("UPDATE upstream_sources SET next_sync_at = ? WHERE id = ?").run(
      new Date(Date.now() - 1000).toISOString(),
      urlSource.id
    );
    const scheduler = new Scheduler(ctx.sourceService, ctx.rulesetService, {
      rulesetCheckIntervalMinutes: 999999
    });
    await scheduler.runTickOnce();

    // 同步报告生成（首次同步的"全部新增"报告 + 本次变化报告）
    const reports = ctx.sourceRepository.listSyncReports(urlSource.id);
    expect(reports.length).toBe(2);
    expect(reports[0]!.nodesAdded.map((n) => n.name)).toContain("SG-01");
    expect(reports[0]!.nodesRenamed[0]).toMatchObject({ from: "HK-01", to: "HK-Prime" });

    // auto 发布了 v2，地区组吸收新节点
    const releases = ctx.subscriptionRepository.listReleases(subscription.id);
    expect(releases[0]!.seq).toBe(2);
    expect(releases[0]!.trigger).toBe("upstream_sync");
    expect(releases[0]!.renderedYaml).toContain("SG-01");
    expect(releases[0]!.renderedHash).not.toBe(v1.renderedHash);
  });

  test("confirm 策略：不自动发布，标记待处理变化", async () => {
    const ctx = createTestContext();
    let servedNodes = defaultNodes;
    globalThis.fetch = (async () =>
      new Response(sourceYaml(servedNodes), { status: 200 })) as unknown as typeof fetch;

    const urlSource = await ctx.sourceService.create(ctx.userId, {
      displayName: "机场C",
      sourceUrl: "https://airport2.test/sub"
    });
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "确认模式",
      sourceIds: [urlSource.id],
      start: { kind: "recommended" }
    });
    ctx.subscriptionService.publish(ctx.userId, subscription.id, { trigger: "manual" });
    ctx.subscriptionService.updateMeta(ctx.userId, subscription.id, { publishPolicy: "confirm" });

    servedNodes = [...defaultNodes, { name: "JP-01", type: "ss", server: "jp1.test", port: 443, cipher: "aes-128-gcm", password: "e" }];
    await ctx.sourceService.sync(urlSource.id);

    const record = ctx.subscriptionRepository.findById(subscription.id)!;
    expect(record.pendingUpstreamChange).toBe(true);
    expect(ctx.subscriptionRepository.listReleases(subscription.id).length).toBe(1);
  });
});

// ── 规则库 ───────────────────────────────────────────────────

describe("规则库", () => {
  test("内置规则源离线可用且有钉版本快照", () => {
    const ctx = createTestContext();
    const list = ctx.rulesetService.list(ctx.userId);
    expect(list.length).toBeGreaterThanOrEqual(10);
    const openai = list.find((entry) => entry.slug === "geosite-openai")!;
    expect(openai.latestSnapshotHash).toBeTruthy();
    const snapshot = ctx.rulesetService.getPublicSnapshot(openai.latestSnapshotHash!);
    expect(snapshot?.content).toContain("openai");
  });

  test("规则源更新：新快照 + 徽章 + 应用到订阅草稿", async () => {
    const ctx = createTestContext();
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "日常",
      sourceIds: [ctx.source.id],
      start: { kind: "recommended" }
    });
    ctx.subscriptionService.publish(ctx.userId, subscription.id, { trigger: "manual" });

    const openai = ctx.rulesetService
      .list(ctx.userId)
      .find((entry) => entry.slug === "geosite-openai")!;
    const oldHash = openai.latestSnapshotHash!;

    globalThis.fetch = (async () =>
      new Response("payload:\n  - '+.openai.com'\n  - '+.chatgpt.com'\n  - '+.new-ai.example'\n", {
        status: 200
      })) as unknown as typeof fetch;

    const result = await ctx.rulesetService.checkForUpdates(openai.id);
    expect(result.updated).toBe(true);
    expect(ctx.rulesetService.getById(ctx.userId, openai.id).updateAvailable).toBe(true);

    const diff = ctx.rulesetService.diffSnapshots(oldHash, result.newHash!);
    expect(diff.addedCount).toBeGreaterThan(0);

    // 应用更新 → 草稿变化 → 发布
    const applied = ctx.subscriptionService.applyRulesetUpdate(ctx.userId, {
      catalogId: openai.id,
      toHash: result.newHash!,
      subscriptionIds: [subscription.id]
    });
    expect(applied[0]!.changed).toBe(true);
    const release = ctx.subscriptionService.publish(ctx.userId, subscription.id, {
      trigger: "ruleset_update",
      triggerDetail: "geosite-openai 更新"
    });
    expect(release.renderedYaml).toContain(result.newHash!);
  });

  test("粘贴规则解析：去重、剥离目标、拒绝非法类型", () => {
    const ctx = createTestContext();
    const report = ctx.rulesetService.parsePaste(
      [
        "DOMAIN-SUFFIX,example.com",
        "domain-suffix , example.com",
        "DOMAIN,foo.bar,SomeGroup",
        "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
        "BOGUS,xx",
        "MATCH,Proxies"
      ].join("\n")
    );
    expect(report.entries.length).toBe(3);
    expect(report.duplicatesRemoved).toBe(1);
    expect(report.strippedTargets).toBe(2);
    expect(report.skippedMatch).toBe(1);
    expect(report.invalid[0]!.reason).toContain("BOGUS");
    expect(report.entries.find((e) => e.type === "IP-CIDR")?.extra).toBe("no-resolve");
  });
});

// ── 规则追踪器 ────────────────────────────────────────────────

describe("规则追踪器", () => {
  test("RULE-SET 命中与 MATCH 兜底", () => {
    const ctx = createTestContext();
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "日常",
      sourceIds: [ctx.source.id],
      start: { kind: "recommended" }
    });
    ctx.subscriptionService.publish(ctx.userId, subscription.id, { trigger: "manual" });

    const hit = ctx.subscriptionService.trace(ctx.userId, subscription.id, "chat.openai.com", false);
    expect(hit.verdict).toBe("hit");
    expect(hit.target).toBe("AI");
    expect(hit.matched?.ruleText).toContain("RULE-SET,geosite-openai");

    // 域名 .example 是保留 TLD，会被 private 规则命中直连——这本身是正确行为；
    // 兜底断言改用 TEST-NET-3 IP（不属于任何 CIDR 规则集）
    const direct = ctx.subscriptionService.trace(
      ctx.userId,
      subscription.id,
      "totally-unknown-domain.example",
      false
    );
    expect(direct.verdict).toBe("hit");
    expect(direct.target).toBe("DIRECT");

    const fallback = ctx.subscriptionService.trace(ctx.userId, subscription.id, "203.0.113.9", false);
    expect(fallback.verdict).toBe("final");
    expect(fallback.target).toBe("Proxies");
  });
});

// ── 模板 v2 ──────────────────────────────────────────────────

describe("模板 v2", () => {
  test("提炼报告剔除原生节点成员；往返收敛", () => {
    const ctx = createTestContext();
    const payload = ctx.templateRepository.findLatestPayload(RECOMMENDED_TEMPLATE_ID)!;
    const config = instantiateTemplate(payload, [ctx.source.id]);

    // 加入一个原生节点成员与一个自建节点
    config.nodes.custom.push({
      id: "cn_home",
      name: "Home VPS",
      type: "trojan",
      server: "home.test",
      port: 443,
      secretRef: ctx.secretStore.create(ctx.userId, { password: "secret" }),
      extra: {}
    });
    config.groups.custom[0]!.members.unshift(
      { kind: "node", nodeId: "n_abcdefabcdef" },
      { kind: "node", nodeId: "cn_home" }
    );

    const first = extractTemplate(config);
    expect("payload" in first).toBe(true);
    if (!("payload" in first)) return;
    // 原生节点被剔除、自建节点保留为占位符
    expect(first.report.dropped.some((item) => item.reason === "native-node-member")).toBe(true);
    expect(first.payload.nodes.custom[0]!.secretPlaceholder).toBe(true);
    const aiMembers = first.payload.groups.custom[0]!.members;
    expect(aiMembers.some((m) => m.kind === "node" && m.nodeId === "cn_home")).toBe(true);
    expect(aiMembers.some((m) => m.kind === "node" && m.nodeId.startsWith("n_"))).toBe(false);

    // 往返收敛：extract(instantiate(extract(x))) === extract(x)
    // （secretPlaceholder 除外——实例化时敏感字段按设计不回填，重提炼后占位符归 false）
    const second = extractTemplate(instantiateTemplate(first.payload, [ctx.source.id]));
    if (!("payload" in second)) throw new Error("second extract failed");
    const normalize = (payload: unknown) =>
      JSON.stringify(payload, (key, value) => (key === "secretPlaceholder" ? undefined : value));
    expect(normalize(second.payload)).toBe(normalize(first.payload));
  });

  test("patch 模式拒绝提炼", () => {
    const ctx = createTestContext();
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "小修",
      sourceIds: [ctx.source.id],
      start: { kind: "patch" }
    });
    const record = ctx.subscriptionRepository.findById(subscription.id)!;
    const result = extractTemplate(record.draftBuildConfig!);
    expect("error" in result && result.error).toContain("patch");
  });
});

// ── 事件流 ───────────────────────────────────────────────────

describe("事件流", () => {
  test("发布与同步失败都会产生事件", async () => {
    const ctx = createTestContext();
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "日常",
      sourceIds: [ctx.source.id],
      start: { kind: "recommended" }
    });
    ctx.subscriptionService.publish(ctx.userId, subscription.id, { trigger: "manual" });

    globalThis.fetch = (async () =>
      new Response("<html>502</html>", { status: 502 })) as unknown as typeof fetch;
    const urlSource = await ctx.sourceService
      .create(ctx.userId, { displayName: "坏机场", sourceUrl: "https://bad.test/sub" })
      .catch(() => null);
    // create 内部 sync 失败被吞掉，但源已创建且事件已记
    expect(urlSource === null || urlSource.lastSyncStatus === "failed").toBe(true);

    const kinds = ctx.events.listByOwner(ctx.userId).map((event) => event.kind);
    expect(kinds).toContain("release.published");
    expect(kinds).toContain("source.sync_failed");
  });
});
