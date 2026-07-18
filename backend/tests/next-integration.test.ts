import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import yaml from "js-yaml";
import { Elysia } from "elysia";

import {
  loadBuiltinRulesetManifest,
  seedBuiltinRulesetCatalog,
  sha256Hex
} from "../src/lib/db/seed-ruleset-catalog";
import {
  RECOMMENDED_TEMPLATE_ID,
  seedBuiltinTemplates
} from "../src/lib/db/seed-builtin-templates";
import { SecretBox } from "../src/lib/security/secret-box";
import { InMemoryRateLimiter } from "../src/lib/security/rate-limiter";
import type { LatencyResult, LatencyTarget } from "../src/lib/latency/mihomo-latency";
import { Scheduler } from "../src/lib/scheduler/scheduler";
import { extractTemplate, instantiateTemplate } from "../src/lib/build-config/template";
import { EventRepository } from "../src/modules/events/event.repository";
import { RulesetRepository } from "../src/modules/rulesets/ruleset.repository";
import { RulesetService } from "../src/modules/rulesets/ruleset.service";
import { SecretStore } from "../src/modules/subscriptions/secret-store";
import { createDeliveryRoutes } from "../src/modules/subscriptions/delivery-routes";
import { createSubscriptionRoutes } from "../src/modules/subscriptions/routes";
import {
  DraftRevisionConflictError,
  SubscriptionRepository
} from "../src/modules/subscriptions/subscription.repository";
import {
  SubscriptionError,
  SubscriptionService,
  type SubscriptionServiceOptions
} from "../src/modules/subscriptions/subscription.service";
import { TemplateRepository } from "../src/modules/templates/template.repository";
import { UpstreamSourceRepository } from "../src/modules/upstream-sources/upstream-source.repository";
import { UpstreamSourceService } from "../src/modules/upstream-sources/upstream-source.service";
import type { ClashProxyDocument } from "../src/types";
import type { AuthService } from "../src/modules/auth/auth.service";

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

const createTestContext = (
  options: {
    mihomo?: boolean;
    latencyRunner?: SubscriptionServiceOptions["latencyRunner"];
    mihomoValidator?: SubscriptionServiceOptions["mihomoValidator"];
    deliveryArtifactDir?: string;
  } = {}
) => {
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
  const secretBox = new SecretBox(randomBytes(32));
  const templateRepository = new TemplateRepository(db, secretBox);
  const subscriptionRepository = new SubscriptionRepository(db);
  const secretStore = new SecretStore(db, secretBox);
  const backendDataDir = resolve(import.meta.dir, "..", "data");
  const subscriptionService = new SubscriptionService(
    subscriptionRepository,
    sourceRepository,
    rulesetRepository,
    templateRepository,
    events,
    secretStore,
    secretBox,
    {
      publicBaseUrl: "https://pp.test",
      mihomo: options.mihomo
        ? {
            mihomoPath: null,
            dataDir: backendDataDir,
            assetsDir: resolve(import.meta.dir, "..", "assets")
          }
        : { mihomoPath: null, dataDir: "/nonexistent-dir", assetsDir: "/nonexistent-dir" },
      latencyRunner: options.latencyRunner,
      mihomoValidator: options.mihomoValidator,
      deliveryArtifactDir: options.deliveryArtifactDir
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
  test("多源空白方案只合并节点、追加来源名，并接受地区范围", () => {
    const ctx = createTestContext();
    const sourceB = ctx.sourceService.createFromUpload(ctx.userId, {
      displayName: "备用机场",
      yamlContent: sourceYaml([{ ...defaultNodes[0], name: "HK-01" }])
    });
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "合并订阅",
      sourceIds: [ctx.source.id, sourceB.id],
      start: { kind: "blank", regionScope: "full" }
    });

    const detail = ctx.subscriptionService.getDetail(ctx.userId, subscription.id);
    const regionGenerator = detail.draftBuildConfig?.groups.generators.find(
      (generator) => generator.kind === "region-groups"
    );
    expect(regionGenerator).toHaveProperty("scope", "full");

    const workspace = ctx.subscriptionService.workspaceIndex(ctx.userId, subscription.id);
    expect(workspace.nodeIndex.map((node) => node.renderedName)).toEqual(
      expect.arrayContaining(["HK-01 · 白云机场", "HK-01 · 备用机场"])
    );
    expect(new Set(workspace.nodeIndex.map((node) => node.id)).size).toBe(
      workspace.nodeIndex.length
    );
    expect(workspace.groupIndex.at(-1)).toMatchObject({
      name: "Final",
      proxies: ["Proxies", "DIRECT"]
    });

    expect(() =>
      ctx.subscriptionService.create(ctx.userId, {
        displayName: "非法透传",
        sourceIds: [ctx.source.id, sourceB.id],
        start: { kind: "patch" }
      })
    ).toThrow("只支持单一订阅源");
  });

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
    expect(groupNames).toEqual(
      expect.arrayContaining(["Proxies", "OpenAI", "Anthropic", "China", "HK", "US"])
    );
    expect(groupNames.at(-1)).toBe("Final");
    expect(doc["proxy-groups"].at(-1)?.proxies).toEqual(["Proxies", "DIRECT"]);
    expect(doc.rules?.[doc.rules.length - 1]).toBe("MATCH,Final");
    // 规则快照以不可变哈希端点输出
    const providers = doc["rule-providers"] as Record<string, { url: string; path: string }>;
    expect(Object.values(providers).every((p) => p.url.startsWith("https://pp.test/rs/"))).toBe(
      true
    );
    for (const provider of Object.values(providers)) {
      const hash = provider.url.match(/\/rs\/([a-f0-9]{64})\.yaml$/)?.[1];
      expect(hash).toBeDefined();
      expect(provider.path).toBe(`./rule-providers/${hash}.yaml`);
    }
    expect(doc.rules).toContain("RULE-SET,anthropic,Anthropic");
    expect(doc.rules).toContain("RULE-SET,china,China");
    expect(doc.rules).toContain("RULE-SET,advertisinglite,REJECT");
    expect(providers).not.toHaveProperty("chinamax");
    expect(providers).not.toHaveProperty("advertising");
    // 发布后健康转绿
    expect(ctx.subscriptionRepository.findById(subscription.id)!.health).toBe("ok");
  });

  test("交付端点复用 gzip 产物并返回固定 Content-Length", async () => {
    const artifactDir = mkdtempSync(resolve(tmpdir(), "proxyparser-delivery-"));
    try {
      const ctx = createTestContext({ deliveryArtifactDir: artifactDir });
      const { subscription, token } = ctx.subscriptionService.create(ctx.userId, {
        displayName: "压缩交付",
        sourceIds: [ctx.source.id],
        start: { kind: "recommended" }
      });
      const release = ctx.subscriptionService.publish(ctx.userId, subscription.id, {
        trigger: "manual"
      });
      const app = new Elysia().use(
        createDeliveryRoutes(
          ctx.subscriptionService,
          ctx.rulesetService,
          new InMemoryRateLimiter()
        )
      );
      const request = () =>
        app.handle(
          new Request(`http://localhost/s/${subscription.id}/${token.token}`, {
            headers: { "Accept-Encoding": "gzip", "User-Agent": "Clash-Verge-rev/e2e" }
          })
        );

      const first = await request();
      expect(first.status).toBe(200);
      expect(first.headers.get("content-encoding")).toBe("gzip");
      const firstBytes = new Uint8Array(await first.arrayBuffer());
      expect(first.headers.get("content-length")).toBe(String(firstBytes.byteLength));
      expect(gunzipSync(firstBytes).toString("utf8")).toBe(release.renderedYaml);

      const second = await request();
      expect(new Uint8Array(await second.arrayBuffer())).toEqual(firstBytes);
      expect(readdirSync(artifactDir).filter((name) => name.endsWith(".yaml.gz"))).toHaveLength(1);
    } finally {
      rmSync(artifactDir, { recursive: true, force: true });
    }
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

  test("草稿 revision 拒绝过期的整份配置覆盖", () => {
    const ctx = createTestContext();
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "并发保护",
      sourceIds: [ctx.source.id],
      start: { kind: "recommended" }
    });
    const initial = ctx.subscriptionService.getDetail(ctx.userId, subscription.id);
    const acceptedDraft = structuredClone(initial.draftBuildConfig!);
    acceptedDraft.config.structured.logLevel = "debug";
    const accepted = ctx.subscriptionService.saveDraft(
      ctx.userId,
      subscription.id,
      acceptedDraft,
      initial.draftRevision
    );
    expect(accepted.draftRevision).toBe(initial.draftRevision + 1);

    const staleDraft = structuredClone(initial.draftBuildConfig!);
    staleDraft.config.structured.logLevel = "error";
    expect(() =>
      ctx.subscriptionService.saveDraft(
        ctx.userId,
        subscription.id,
        staleDraft,
        initial.draftRevision
      )
    ).toThrow("草稿已在其他页面或操作中更新");

    const current = ctx.subscriptionService.getDetail(ctx.userId, subscription.id);
    expect(current.draftRevision).toBe(accepted.draftRevision);
    expect(current.draftBuildConfig?.config.structured.logLevel).toBe("debug");

    expect(() =>
      ctx.subscriptionService.publish(ctx.userId, subscription.id, {
        trigger: "manual",
        expectedDraftRevision: initial.draftRevision
      })
    ).toThrow("请重新预览");

    expect(() =>
      ctx.subscriptionService.discardDraft(
        ctx.userId,
        subscription.id,
        initial.draftRevision
      )
    ).toThrow("无法放弃较新的内容");
    const discarded = ctx.subscriptionService.discardDraft(
      ctx.userId,
      subscription.id,
      current.draftRevision
    );
    expect(discarded.draftRevision).toBe(current.draftRevision + 1);
    expect(discarded.draftBuildConfig).toBeNull();
  });

  test("草稿期间同时跟踪已发布与草稿订阅源", () => {
    const ctx = createTestContext();
    const sourceB = ctx.sourceService.createFromUpload(ctx.userId, {
      displayName: "备用机场",
      yamlContent: sourceYaml(defaultNodes)
    });
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "索引一致性",
      sourceIds: [ctx.source.id],
      start: { kind: "recommended" }
    });
    ctx.subscriptionService.publish(ctx.userId, subscription.id, { trigger: "manual" });

    const published = ctx.subscriptionService.getDetail(ctx.userId, subscription.id);
    const draftForB = structuredClone(published.buildConfig!);
    draftForB.sources = [{ sourceId: sourceB.id, enabled: true }];
    const savedForB = ctx.subscriptionService.saveDraft(
      ctx.userId,
      subscription.id,
      draftForB,
      published.draftRevision
    );
    expect(
      ctx.subscriptionRepository.listBySource(ctx.source.id).some((item) => item.id === subscription.id)
    ).toBe(true);
    expect(
      ctx.subscriptionRepository.listBySource(sourceB.id).some((item) => item.id === subscription.id)
    ).toBe(true);

    const discarded = ctx.subscriptionService.discardDraft(
      ctx.userId,
      subscription.id,
      savedForB.draftRevision
    );
    expect(discarded.draftBuildConfig).toBeNull();
    expect(
      ctx.subscriptionRepository.listBySource(ctx.source.id).some((item) => item.id === subscription.id)
    ).toBe(true);
    expect(
      ctx.subscriptionRepository.listBySource(sourceB.id).some((item) => item.id === subscription.id)
    ).toBe(false);

    const savedForBAgain = ctx.subscriptionService.saveDraft(
      ctx.userId,
      subscription.id,
      draftForB,
      discarded.draftRevision
    );
    const returnedToPublished = ctx.subscriptionService.saveDraft(
      ctx.userId,
      subscription.id,
      structuredClone(published.buildConfig!),
      savedForBAgain.draftRevision
    );
    expect(returnedToPublished.draftBuildConfig).toBeNull();
    expect(
      ctx.subscriptionRepository.listBySource(ctx.source.id).some((item) => item.id === subscription.id)
    ).toBe(true);
    expect(
      ctx.subscriptionRepository.listBySource(sourceB.id).some((item) => item.id === subscription.id)
    ).toBe(false);
  });

  test("发布激活在数据库内 CAS，过期 revision 不留下孤立 release", () => {
    const ctx = createTestContext();
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "发布 CAS",
      sourceIds: [ctx.source.id],
      start: { kind: "recommended" }
    });
    const v1 = ctx.subscriptionService.publish(ctx.userId, subscription.id, {
      trigger: "manual"
    });
    const v1Detail = ctx.subscriptionRepository.findReleaseById(v1.id)!;
    const expectedDraftRevision = ctx.subscriptionRepository.findById(subscription.id)!.draftRevision;
    const releaseInput = {
      subscriptionId: subscription.id,
      buildConfig: v1Detail.buildConfig,
      sourceSnapshotIds: v1Detail.sourceSnapshotIds,
      renderedYaml: v1Detail.renderedYaml,
      renderedHash: v1Detail.renderedHash,
      diffSummary: {},
      trigger: "manual" as const,
      triggerDetail: "CAS test",
      validation: v1Detail.validation,
      createdBy: ctx.userId,
      expectedDraftRevision
    };

    const v2 = ctx.subscriptionRepository.createRelease(releaseInput);
    expect(v2.seq).toBe(2);
    expect(() => ctx.subscriptionRepository.createRelease(releaseInput)).toThrow(
      DraftRevisionConflictError
    );
    const releases = ctx.subscriptionRepository.listReleases(subscription.id);
    expect(releases.map((release) => release.seq)).toEqual([2, 1]);
    expect(ctx.subscriptionRepository.findById(subscription.id)!.activeReleaseId).toBe(v2.id);
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

    const beforeRollback = ctx.subscriptionService.getDetail(ctx.userId, subscription.id);
    const rollbackDraft = structuredClone(beforeRollback.buildConfig!);
    rollbackDraft.config.structured.logLevel = "warning";
    const savedRollbackDraft = ctx.subscriptionService.saveDraft(
      ctx.userId,
      subscription.id,
      rollbackDraft,
      beforeRollback.draftRevision
    );
    expect(() =>
      ctx.subscriptionService.rollback(
        ctx.userId,
        subscription.id,
        v1.id,
        savedRollbackDraft.draftRevision
      )
    ).toThrow("请先发布或放弃草稿");
    const afterBlockedRollback = ctx.subscriptionService.getDetail(
      ctx.userId,
      subscription.id
    );
    expect(afterBlockedRollback.draftBuildConfig?.config.structured.logLevel).toBe("warning");

    const discardedRollbackDraft = ctx.subscriptionService.discardDraft(
      ctx.userId,
      subscription.id,
      afterBlockedRollback.draftRevision
    );
    const v3 = ctx.subscriptionService.rollback(
      ctx.userId,
      subscription.id,
      v1.id,
      discardedRollbackDraft.draftRevision
    );
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

// ── 节点延迟测试 ─────────────────────────────────────────────

describe("节点延迟测试", () => {
  test("测速只收集节点，不读取或展开规则正文", async () => {
    const ctx = createTestContext();
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "轻量测速",
      sourceIds: [ctx.source.id],
      start: { kind: "recommended" }
    });
    let rulesetSnapshotReads = 0;
    ctx.rulesetRepository.findSnapshot = () => {
      rulesetSnapshotReads += 1;
      throw new Error("latency must not load ruleset content");
    };

    await expect(
      ctx.subscriptionService.testLatency(ctx.userId, subscription.id, ["missing-node"])
    ).rejects.toThrow("不存在或已禁用");
    expect(rulesetSnapshotReads).toBe(0);
  });

  test("第三个独立测速请求进入 FIFO 等待，不会因两个运行中请求直接 429", async () => {
    const controls: Array<{
      targets: LatencyTarget[];
      resolve: (results: LatencyResult[]) => void;
    }> = [];
    const runner: NonNullable<SubscriptionServiceOptions["latencyRunner"]> = (targets) =>
      new Promise<LatencyResult[]>((resolveRun) => {
        controls.push({ targets, resolve: resolveRun });
      });
    const ctx = createTestContext({ latencyRunner: runner });
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "并发测速",
      sourceIds: [ctx.source.id],
      start: { kind: "recommended" }
    });
    const nodeId = ctx.subscriptionService.workspaceIndex(ctx.userId, subscription.id)
      .nodeIndex[0]!.id;
    const requests = [
      ctx.subscriptionService.testLatency(ctx.userId, subscription.id, [nodeId]),
      ctx.subscriptionService.testLatency(ctx.userId, subscription.id, [nodeId]),
      ctx.subscriptionService.testLatency(ctx.userId, subscription.id, [nodeId])
    ];
    await new Promise<void>((resolveTick) => setTimeout(resolveTick, 0));
    expect(controls).toHaveLength(2);

    const resultFor = (target: LatencyTarget): LatencyResult => ({
      nodeId: target.nodeId,
      name: target.name,
      status: "ok",
      delayMs: 12
    });
    controls[0]!.resolve(controls[0]!.targets.map(resultFor));
    await requests[0];
    await new Promise<void>((resolveTick) => setTimeout(resolveTick, 0));
    expect(controls).toHaveLength(3);

    controls[1]!.resolve(controls[1]!.targets.map(resultFor));
    controls[2]!.resolve(controls[2]!.targets.map(resultFor));
    const responses = await Promise.all(requests);
    expect(responses.map((response) => response.results[0]?.status)).toEqual([
      "ok",
      "ok",
      "ok"
    ]);
  });
});

// ── 上游变化吸收与调度器 ───────────────────────────────────────

describe("上游吸收", () => {
  test("上传 YAML 可替换或编辑，并生成报告通知引用订阅", async () => {
    const ctx = createTestContext();
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "上传源更新",
      sourceIds: [ctx.source.id],
      start: { kind: "recommended" }
    });
    ctx.subscriptionService.publish(ctx.userId, subscription.id, { trigger: "manual" });
    ctx.subscriptionService.updateMeta(ctx.userId, subscription.id, { publishPolicy: "confirm" });

    const replacement = sourceYaml([
      ...defaultNodes,
      {
        name: "JP-Upload",
        type: "ss",
        server: "jp-upload.test",
        port: 443,
        cipher: "aes-128-gcm",
        password: "updated"
      }
    ]);
    const updated = await ctx.sourceService.replaceUpload(
      ctx.userId,
      ctx.source.id,
      replacement,
      "replacement.yml"
    );

    expect(updated.uploadedFileName).toBe("replacement.yml");
    expect(updated.proxyCount).toBe(defaultNodes.length + 1);
    const content = ctx.sourceService.getUploadContent(ctx.userId, ctx.source.id);
    expect(content.yamlContent).toBe(replacement);
    expect(content.uploadedFileName).toBe("replacement.yml");
    expect(content.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(ctx.sourceRepository.listSyncReports(ctx.source.id)[0]!.nodesAdded).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "JP-Upload" })])
    );
    expect(ctx.subscriptionRepository.findById(subscription.id)!.pendingUpstreamChange).toBe(true);
    expect(ctx.subscriptionRepository.listReleases(subscription.id)).toHaveLength(1);
  });

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

  test("预览后上游快照变化时拒绝发布未确认的渲染结果", async () => {
    const ctx = createTestContext();
    let servedNodes = defaultNodes;
    globalThis.fetch = (async () =>
      new Response(sourceYaml(servedNodes), { status: 200 })) as unknown as typeof fetch;

    const urlSource = await ctx.sourceService.create(ctx.userId, {
      displayName: "预览门禁源",
      sourceUrl: "https://preview-gate.test/sub"
    });
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "预览门禁",
      sourceIds: [urlSource.id],
      start: { kind: "recommended" }
    });
    ctx.subscriptionService.publish(ctx.userId, subscription.id, { trigger: "manual" });
    ctx.subscriptionService.updateMeta(ctx.userId, subscription.id, { publishPolicy: "confirm" });

    const preview = ctx.subscriptionService.preview(ctx.userId, subscription.id);
    servedNodes = [
      ...defaultNodes,
      {
        name: "JP-Preview",
        type: "ss",
        server: "jp-preview.test",
        port: 443,
        cipher: "aes-128-gcm",
        password: "preview"
      }
    ];
    await ctx.sourceService.sync(urlSource.id);

    expect(() =>
      ctx.subscriptionService.publish(ctx.userId, subscription.id, {
        trigger: "manual",
        expectedDraftRevision: preview.draftRevision,
        expectedRenderedHash: preview.renderedHash
      })
    ).toThrow("请重新预览");
    expect(ctx.subscriptionRepository.listReleases(subscription.id)).toHaveLength(1);

    const refreshedPreview = ctx.subscriptionService.preview(ctx.userId, subscription.id);
    const release = ctx.subscriptionService.publish(ctx.userId, subscription.id, {
      trigger: "manual",
      expectedDraftRevision: refreshedPreview.draftRevision,
      expectedRenderedHash: refreshedPreview.renderedHash
    });
    expect(release.renderedYaml).toContain("JP-Preview");
  });

  test("发布候选只渲染一次、Mihomo 只校验一次，并原子发布同一份字节", async () => {
    let validationCalls = 0;
    let validatedYaml = "";
    const ctx = createTestContext({
      mihomoValidator: async (yamlText) => {
        validationCalls += 1;
        validatedYaml = yamlText;
        return {
          available: true,
          passed: true,
          exitCode: 0,
          output: "configuration test is successful",
          durationMs: 12
        };
      }
    });
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "候选原子发布",
      sourceIds: [ctx.source.id],
      start: { kind: "recommended" }
    });

    let rulesetSnapshotReads = 0;
    const originalFindSnapshot = ctx.rulesetRepository.findSnapshot.bind(ctx.rulesetRepository);
    ctx.rulesetRepository.findSnapshot = (hash: string) => {
      rulesetSnapshotReads += 1;
      return originalFindSnapshot(hash);
    };

    const candidate = ctx.subscriptionService.preparePublishCandidate(
      ctx.userId,
      subscription.id
    );
    const readsAfterRender = rulesetSnapshotReads;
    expect(readsAfterRender).toBeGreaterThan(0);
    expect(candidate.phase).toBe("rendered");
    expect(candidate).not.toHaveProperty("renderedYaml");

    const [validated, duplicateValidation] = await Promise.all([
      ctx.subscriptionService.validatePublishCandidate(
        ctx.userId,
        subscription.id,
        candidate.candidateId
      ),
      ctx.subscriptionService.validatePublishCandidate(
        ctx.userId,
        subscription.id,
        candidate.candidateId
      )
    ]);
    expect(validated.phase).toBe("validated");
    expect(duplicateValidation).toEqual(validated);
    expect(validated.mihomo?.passed).toBe(true);
    expect(validationCalls).toBe(1);
    expect(rulesetSnapshotReads).toBe(readsAfterRender);

    const cachedValidation = await ctx.subscriptionService.validatePublishCandidate(
      ctx.userId,
      subscription.id,
      candidate.candidateId
    );
    expect(cachedValidation).toEqual(validated);
    expect(validationCalls).toBe(1);

    const release = ctx.subscriptionService.publishPreparedCandidate(
      ctx.userId,
      subscription.id,
      {
        candidateId: candidate.candidateId,
        expectedDraftRevision: candidate.draftRevision,
        expectedRenderedHash: candidate.renderedHash
      }
    );
    expect(release.renderedYaml).toBe(validatedYaml);
    expect(release.renderedHash).toBe(candidate.renderedHash);
    expect(release.validation.mihomo?.durationMs).toBe(12);
    expect(validationCalls).toBe(1);
    expect(rulesetSnapshotReads).toBe(readsAfterRender);
  });

  test("发布候选校验后上游快照变化时拒绝提升旧候选", async () => {
    const ctx = createTestContext({
      mihomoValidator: async () => ({
        available: true,
        passed: true,
        exitCode: 0,
        output: null,
        durationMs: 1
      })
    });
    let servedNodes = defaultNodes;
    globalThis.fetch = (async () =>
      new Response(sourceYaml(servedNodes), { status: 200 })) as unknown as typeof fetch;
    const urlSource = await ctx.sourceService.create(ctx.userId, {
      displayName: "候选快照源",
      sourceUrl: "https://candidate-snapshot.test/sub"
    });
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "候选快照保护",
      sourceIds: [urlSource.id],
      start: { kind: "recommended" }
    });
    const candidate = ctx.subscriptionService.preparePublishCandidate(ctx.userId, subscription.id);
    await ctx.subscriptionService.validatePublishCandidate(
      ctx.userId,
      subscription.id,
      candidate.candidateId
    );

    servedNodes = [
      ...defaultNodes,
      { name: "New", type: "ss", server: "new.test", port: 443, cipher: "aes-128-gcm", password: "new" }
    ];
    await ctx.sourceService.sync(urlSource.id);

    expect(() =>
      ctx.subscriptionService.publishPreparedCandidate(ctx.userId, subscription.id, {
        candidateId: candidate.candidateId,
        expectedDraftRevision: candidate.draftRevision,
        expectedRenderedHash: candidate.renderedHash
      })
    ).toThrow("上游订阅已在候选版本生成后变化");
    expect(ctx.subscriptionRepository.listReleases(subscription.id)).toHaveLength(0);
  });

  test("工作区索引不读取规则正文，完整 YAML 仅由按需预览返回", () => {
    const ctx = createTestContext();
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "轻量工作区",
      sourceIds: [ctx.source.id],
      start: { kind: "recommended" }
    });

    let rulesetSnapshotReads = 0;
    const originalFindSnapshot = ctx.rulesetRepository.findSnapshot.bind(ctx.rulesetRepository);
    ctx.rulesetRepository.findSnapshot = (hash: string) => {
      rulesetSnapshotReads += 1;
      return originalFindSnapshot(hash);
    };

    const workspace = ctx.subscriptionService.workspaceIndex(ctx.userId, subscription.id);
    expect(rulesetSnapshotReads).toBe(0);
    expect(workspace.draftRevision).toBe(subscription.draftRevision);
    expect(workspace.stats.nodeCount).toBe(defaultNodes.length);
    expect(workspace.stats.groupCount).toBeGreaterThan(0);
    expect(workspace.nodeIndex).toHaveLength(defaultNodes.length);
    expect(workspace.groupIndex.length).toBe(workspace.stats.groupCount);
    expect(
      workspace.issues.some((issue) => issue.kind === "missing-ruleset-snapshot")
    ).toBe(false);
    expect(workspace).not.toHaveProperty("yamlText");
    expect(JSON.stringify(workspace)).not.toContain('"password"');

    const preview = ctx.subscriptionService.preview(ctx.userId, subscription.id);
    expect(rulesetSnapshotReads).toBeGreaterThan(0);
    expect(preview).not.toHaveProperty("yamlText");
    expect(preview.yamlBytes).toBeGreaterThan(0);

    const yamlPreview = ctx.subscriptionService.previewYaml(ctx.userId, subscription.id);
    expect(yamlPreview.draftRevision).toBe(preview.draftRevision);
    expect(yamlPreview.renderedHash).toBe(preview.renderedHash);
    expect(Buffer.byteLength(yamlPreview.yamlText, "utf8")).toBe(preview.yamlBytes);
    expect(yamlPreview.yamlText).toContain("proxy-groups:");
  });

  test("版本摘要查询不携带 rendered_yaml，完整产物仍可按需读取", () => {
    const ctx = createTestContext();
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "版本摘要",
      sourceIds: [ctx.source.id],
      start: { kind: "recommended" }
    });
    const release = ctx.subscriptionService.publish(ctx.userId, subscription.id, {
      trigger: "manual"
    });

    const summary = ctx.subscriptionRepository.findReleaseSummaryById(release.id)!;
    const summaries = ctx.subscriptionRepository.listReleaseSummaries(subscription.id);
    expect(summary).not.toHaveProperty("renderedYaml");
    expect(summary).not.toHaveProperty("buildConfig");
    expect(summaries[0]).toEqual(summary);
    const artifact = ctx.subscriptionRepository.findReleaseArtifactById(release.id)!;
    expect(artifact.renderedYaml).toContain("proxy-groups:");
    expect(artifact.renderedHash).toBe(summary.renderedHash);
  });

  test("预览路由默认返回轻量 JSON，YAML 路由返回带校验头的原始正文", async () => {
    const ctx = createTestContext({
      mihomoValidator: async () => ({
        available: true,
        passed: true,
        exitCode: 0,
        output: null,
        durationMs: 3
      })
    });
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "预览路由",
      sourceIds: [ctx.source.id],
      start: { kind: "recommended" }
    });
    const now = new Date().toISOString();
    const authService = {
      authenticate: () => ({
        id: ctx.userId,
        email: "alice@test.local",
        username: "alice",
        displayName: "Alice",
        locale: "zh-CN",
        status: "active" as const,
        isAdmin: false,
        createdAt: now,
        updatedAt: now
      })
    } as unknown as AuthService;
    const app = new Elysia().use(
      createSubscriptionRoutes(
        authService,
        ctx.subscriptionService,
        ctx.secretStore,
        new InMemoryRateLimiter()
      )
    );

    const workspaceResponse = await app.handle(
      new Request(`http://localhost/api/subscriptions/${subscription.id}/workspace-index`, {
        method: "POST"
      })
    );
    expect(workspaceResponse.status).toBe(200);
    const workspacePayload = await workspaceResponse.json() as Record<string, unknown>;
    expect(workspacePayload).not.toHaveProperty("yamlText");
    expect(workspacePayload).toHaveProperty("nodeIndex");

    const previewResponse = await app.handle(
      new Request(`http://localhost/api/subscriptions/${subscription.id}/preview`, {
        method: "POST"
      })
    );
    expect(previewResponse.status).toBe(200);
    const previewPayload = await previewResponse.json() as Record<string, unknown>;
    expect(previewPayload).not.toHaveProperty("yamlText");
    expect(previewPayload).toHaveProperty("yamlBytes");

    const yamlResponse = await app.handle(
      new Request(`http://localhost/api/subscriptions/${subscription.id}/preview/yaml`, {
        method: "POST"
      })
    );
    expect(yamlResponse.status).toBe(200);
    expect(yamlResponse.headers.get("content-type")).toContain("application/yaml");
    expect(yamlResponse.headers.get("cache-control")).toBe("no-store");
    expect(yamlResponse.headers.get("access-control-expose-headers")).toContain(
      "X-Draft-Revision"
    );
    expect(yamlResponse.headers.get("access-control-expose-headers")).toContain(
      "X-Rendered-Hash"
    );
    expect(yamlResponse.headers.get("x-draft-revision")).toBe(String(subscription.draftRevision));
    expect(yamlResponse.headers.get("x-rendered-hash")).toBe(previewPayload.renderedHash);
    expect(yamlResponse.headers.get("etag")).toBe(`"${previewPayload.renderedHash}"`);
    const yamlText = await yamlResponse.text();
    expect(Buffer.byteLength(yamlText, "utf8")).toBe(previewPayload.yamlBytes);
    expect(yamlText).toContain("proxy-groups:");

    const candidateResponse = await app.handle(
      new Request(`http://localhost/api/subscriptions/${subscription.id}/publish-candidates`, {
        method: "POST"
      })
    );
    expect(candidateResponse.status).toBe(200);
    const candidate = await candidateResponse.json() as {
      candidateId: string;
      phase: string;
      draftRevision: number;
      renderedHash: string;
    };
    expect(candidate.phase).toBe("rendered");
    const validationResponse = await app.handle(
      new Request(
        `http://localhost/api/subscriptions/${subscription.id}/publish-candidates/${candidate.candidateId}/validate`,
        { method: "POST" }
      )
    );
    expect(validationResponse.status).toBe(200);
    expect((await validationResponse.json() as { phase: string }).phase).toBe("validated");
    const publishResponse = await app.handle(
      new Request(`http://localhost/api/subscriptions/${subscription.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: candidate.candidateId,
          expectedDraftRevision: candidate.draftRevision,
          expectedRenderedHash: candidate.renderedHash
        })
      })
    );
    expect(publishResponse.status).toBe(200);
  });

  test("auto 策略遇到未发布草稿时只标记变化，不夹带草稿发布", async () => {
    const ctx = createTestContext();
    let servedNodes = defaultNodes;
    globalThis.fetch = (async () =>
      new Response(sourceYaml(servedNodes), { status: 200 })) as unknown as typeof fetch;

    const urlSource = await ctx.sourceService.create(ctx.userId, {
      displayName: "草稿保护源",
      sourceUrl: "https://draft-guard.test/sub"
    });
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "草稿保护",
      sourceIds: [urlSource.id],
      start: { kind: "recommended" }
    });
    ctx.subscriptionService.publish(ctx.userId, subscription.id, { trigger: "manual" });
    const beforeDraft = ctx.subscriptionService.getDetail(ctx.userId, subscription.id);
    const draft = structuredClone(beforeDraft.buildConfig!);
    draft.config.structured.logLevel = "debug";
    ctx.subscriptionService.saveDraft(
      ctx.userId,
      subscription.id,
      draft,
      beforeDraft.draftRevision
    );

    servedNodes = [
      ...defaultNodes,
      {
        name: "SG-Draft",
        type: "ss",
        server: "sg-draft.test",
        port: 443,
        cipher: "aes-128-gcm",
        password: "draft"
      }
    ];
    await ctx.sourceService.sync(urlSource.id);

    const afterSync = ctx.subscriptionRepository.findById(subscription.id)!;
    expect(ctx.subscriptionRepository.listReleases(subscription.id)).toHaveLength(1);
    expect(afterSync.pendingUpstreamChange).toBe(true);
    expect(afterSync.draftBuildConfig?.config.structured.logLevel).toBe("debug");
    expect(afterSync.buildConfig?.config.structured.logLevel).not.toBe("debug");
  });
});

// ── 规则库 ───────────────────────────────────────────────────

describe("规则库", () => {
  test("内置规则源离线可用且有钉版本快照", () => {
    const ctx = createTestContext();
    const list = ctx.rulesetService.list(ctx.userId);
    expect(list.length).toBeGreaterThanOrEqual(10);
    const openai = list.find((entry) => entry.slug === "openai")!;
    expect(openai.latestSnapshotHash).toBeTruthy();
    const snapshot = ctx.rulesetService.getPublicSnapshot(openai.latestSnapshotHash!);
    expect(snapshot?.content).toContain("openai");
  });

  test("内置规则后处理补齐 China/ChinaMax GEOIP 与 Anthropic 官方域名", () => {
    const ctx = createTestContext();
    const manifest = loadBuiltinRulesetManifest();
    const payloadBySlug = new Map<string, string[]>();
    const expectedBySlug = new Map<string, string[]>([
      ["china", ["GEOIP,CN,no-resolve"]],
      ["chinamax", ["GEOIP,CN,no-resolve"]],
      [
        "anthropic",
        [
          "DOMAIN-SUFFIX,claude.com",
          "DOMAIN,servd-anthropic-website.b-cdn.net"
        ]
      ]
    ]);

    for (const [slug, expectedRules] of expectedBySlug) {
      const manifestEntry = manifest.find((entry) => entry.slug === slug);
      for (const expectedRule of expectedRules) {
        expect(manifestEntry?.extraRules).toContain(expectedRule);
      }

      const catalog = ctx.rulesetService.list(ctx.userId).find((entry) => entry.slug === slug);
      expect(catalog?.latestSnapshotHash).toBeTruthy();
      const snapshot = ctx.rulesetService.getPublicSnapshot(catalog!.latestSnapshotHash!);
      const parsed = yaml.load(snapshot!.content) as { payload: string[] };
      payloadBySlug.set(slug, parsed.payload);
      for (const expectedRule of expectedRules) {
        expect(parsed.payload.filter((rule) => rule === expectedRule)).toHaveLength(1);
      }
    }

    const chinaMaxManifest = manifest.find((entry) => entry.slug === "chinamax")!;
    expect(chinaMaxManifest.sources).toEqual([
      {
        kind: "classical",
        url: "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/ChinaMax/ChinaMax_Classical_No_Resolve.yaml"
      }
    ]);
    const chinaMaxPayload = payloadBySlug.get("chinamax")!;
    expect(chinaMaxPayload.some((rule) => rule.startsWith("IP-CIDR,") && rule.endsWith(",no-resolve"))).toBe(true);
    expect(chinaMaxPayload.some((rule) => rule.startsWith("IP-CIDR6,") && rule.endsWith(",no-resolve"))).toBe(true);
  });

  test("启动 seed 提升缺少 mandatory extraRules 的旧快照且不降级较新的完整快照", () => {
    const ctx = createTestContext();
    const anthropic = ctx.rulesetService
      .list(ctx.userId)
      .find((entry) => entry.slug === "anthropic")!;
    const manifestEntry = loadBuiltinRulesetManifest().find((entry) => entry.slug === "anthropic")!;
    const bundledHash = anthropic.latestSnapshotHash!;
    const now = new Date().toISOString();

    const staleContent = yaml.dump({ payload: ["DOMAIN-SUFFIX,anthropic.com"] });
    const staleHash = sha256Hex(staleContent);
    ctx.rulesetRepository.insertSnapshot({
      hash: staleHash,
      catalogId: anthropic.id,
      content: staleContent,
      behavior: "classical",
      entryCount: 1,
      isPublic: true,
      fetchedAt: now
    });
    ctx.rulesetRepository.setLatestSnapshot(anthropic.id, staleHash, false);

    seedBuiltinRulesetCatalog(ctx.db);
    const promoted = ctx.rulesetService.getById(ctx.userId, anthropic.id);
    expect(promoted.latestSnapshotHash).toBe(bundledHash);
    expect(promoted.updateAvailable).toBe(true);

    const futurePayload = [
      ...(manifestEntry.extraRules ?? []),
      "DOMAIN-SUFFIX,future-anthropic.example"
    ];
    const futureContent = yaml.dump({ payload: futurePayload });
    const futureHash = sha256Hex(futureContent);
    ctx.rulesetRepository.insertSnapshot({
      hash: futureHash,
      catalogId: anthropic.id,
      content: futureContent,
      behavior: "classical",
      entryCount: futurePayload.length,
      isPublic: true,
      fetchedAt: now
    });
    ctx.rulesetRepository.setLatestSnapshot(anthropic.id, futureHash, false);

    seedBuiltinRulesetCatalog(ctx.db);
    const preserved = ctx.rulesetService.getById(ctx.userId, anthropic.id);
    expect(preserved.latestSnapshotHash).toBe(futureHash);
    expect(preserved.updateAvailable).toBe(false);
  });

  test("规则源检查失败会持久化错误并向调用方返回失败", async () => {
    const ctx = createTestContext();
    const anthropic = ctx.rulesetService
      .list(ctx.userId)
      .find((entry) => entry.slug === "anthropic")!;
    const oldHash = anthropic.latestSnapshotHash;

    globalThis.fetch = (async () =>
      new Response("upstream unavailable", { status: 503 })) as unknown as typeof fetch;

    await expect(ctx.rulesetService.checkForUpdates(anthropic.id)).rejects.toThrow(
      "检查更新失败：HTTP 503"
    );
    const failed = ctx.rulesetService.getById(ctx.userId, anthropic.id);
    expect(failed.latestSnapshotHash).toBe(oldHash);
    expect(failed.lastCheckedAt).toBeTruthy();
    expect(failed.lastCheckError).toContain("HTTP 503");
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
      .find((entry) => entry.slug === "openai")!;
    const oldHash = openai.latestSnapshotHash!;

    globalThis.fetch = (async () =>
      new Response(
        "payload:\n  - DOMAIN-SUFFIX,openai.com\n  - DOMAIN-SUFFIX,chatgpt.com\n  - DOMAIN-SUFFIX,new-ai.example\n",
        { status: 200 }
      )) as unknown as typeof fetch;

    const result = await ctx.rulesetService.checkForUpdates(openai.id);
    expect(result.updated).toBe(true);
    expect(ctx.rulesetService.getById(ctx.userId, openai.id).updateAvailable).toBe(true);

    const diff = ctx.rulesetService.diffSnapshots(oldHash, result.newHash!);
    expect(diff.addedCount).toBeGreaterThan(0);

    // 应用更新 → 草稿变化 → 发布
    const applied = ctx.subscriptionService.applyRulesetUpdate(ctx.userId, {
      catalogId: openai.id,
      toHash: result.newHash!,
      subscriptions: [
        {
          id: subscription.id,
          expectedDraftRevision: ctx.subscriptionRepository.findById(subscription.id)!.draftRevision
        }
      ]
    });
    expect(applied[0]!.changed).toBe(true);
    const release = ctx.subscriptionService.publish(ctx.userId, subscription.id, {
      trigger: "ruleset_update",
      triggerDetail: "openai 更新"
    });
    expect(release.renderedYaml).toContain(result.newHash!);
  });

  test("当前订阅一键同步到规则库 latest 只更新草稿且按 catalog 去重", () => {
    const ctx = createTestContext();
    const { subscription, token } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "日常",
      sourceIds: [ctx.source.id],
      start: { kind: "recommended" }
    });
    const activeRelease = ctx.subscriptionService.publish(ctx.userId, subscription.id, {
      trigger: "manual"
    });
    const deliveredBefore = ctx.subscriptionService.deliver(
      subscription.id,
      token.token,
      "token",
      null,
      null
    ).yamlText;

    const openai = ctx.rulesetService
      .list(ctx.userId)
      .find((entry) => entry.slug === "openai")!;
    const oldHash = openai.latestSnapshotHash!;
    const revisionBeforeDraft = ctx.subscriptionRepository.findById(subscription.id)!.draftRevision;
    const draft = structuredClone(
      ctx.subscriptionRepository.findById(subscription.id)!.buildConfig!
    );
    const openaiBlock = draft.rules.targets.find((block) => block.target === "OpenAI")!;
    const openaiItem = openaiBlock.items.find(
      (item) => item.kind === "snapshot" && item.catalogId === openai.id
    )!;
    const duplicateOpenAiItem = structuredClone(openaiItem);
    duplicateOpenAiItem.hash = "hash_other_openai_snapshot";
    openaiBlock.items.push(duplicateOpenAiItem);
    draft.config.structured.logLevel = "debug";
    ctx.subscriptionRepository.saveDraft(subscription.id, draft);

    const newContent = [
      "payload:",
      "  - DOMAIN-SUFFIX,openai.com",
      "  - DOMAIN-SUFFIX,chatgpt.com",
      "  - DOMAIN-SUFFIX,new-ai.example",
      ""
    ].join("\n");
    const newHash = sha256Hex(newContent);
    ctx.rulesetRepository.insertSnapshot({
      hash: newHash,
      catalogId: openai.id,
      content: newContent,
      behavior: openai.behavior,
      entryCount: 3,
      isPublic: true,
      fetchedAt: new Date().toISOString()
    });
    ctx.rulesetRepository.setLatestSnapshot(openai.id, newHash, true);

    expect(() =>
      ctx.subscriptionService.syncRulesetsToLatest(
        ctx.userId,
        subscription.id,
        revisionBeforeDraft
      )
    ).toThrow("请重新载入后再同步规则");

    const uniqueCatalogCount = new Set(
      draft.rules.targets.flatMap((block) =>
        block.items
          .filter((item) => item.kind === "snapshot")
          .map((item) => item.catalogId)
      )
    ).size;
    const synced = ctx.subscriptionService.syncRulesetsToLatest(
      ctx.userId,
      subscription.id,
      ctx.subscriptionRepository.findById(subscription.id)!.draftRevision
    );
    const {
      buildConfig: syncedBuildConfig,
      draftRevision: syncedDraftRevision,
      ...syncedSummary
    } = synced;

    expect(syncedSummary).toEqual({
      changes: [
        {
          catalogId: openai.id,
          slug: openai.slug,
          fromHashes: [oldHash, "hash_other_openai_snapshot"],
          toHash: newHash,
          updatedReferenceCount: 2
        }
      ],
      unchangedCount: uniqueCatalogCount - 1,
      skipped: []
    });

    const afterSync = ctx.subscriptionRepository.findById(subscription.id)!;
    expect(syncedBuildConfig).toEqual(afterSync.draftBuildConfig);
    expect(syncedDraftRevision).toBe(afterSync.draftRevision);
    const syncedOpenAiItems = afterSync.draftBuildConfig!.rules.targets
      .flatMap((block) => block.items)
      .filter((item) => item.kind === "snapshot" && item.catalogId === openai.id);
    expect(syncedOpenAiItems).toHaveLength(2);
    expect(syncedOpenAiItems.every((item) => item.hash === newHash)).toBe(true);
    expect(afterSync.draftBuildConfig!.config.structured.logLevel).toBe("debug");
    expect(afterSync.publishPolicy).toBe("auto");
    expect(ctx.rulesetRepository.findById(openai.id)?.updateAvailable).toBe(true);
    expect(
      afterSync.buildConfig!.rules.targets
        .flatMap((block) => block.items)
        .find((item) => item.kind === "snapshot" && item.catalogId === openai.id)?.hash
    ).toBe(oldHash);

    const unchanged = ctx.subscriptionService.syncRulesetsToLatest(
      ctx.userId,
      subscription.id,
      afterSync.draftRevision
    );
    const {
      buildConfig: unchangedBuildConfig,
      draftRevision: unchangedDraftRevision,
      ...unchangedSummary
    } = unchanged;
    expect(unchangedSummary).toEqual({
      changes: [],
      unchangedCount: uniqueCatalogCount,
      skipped: []
    });
    expect(unchangedBuildConfig).toEqual(afterSync.draftBuildConfig);
    expect(unchangedDraftRevision).toBe(afterSync.draftRevision);

    const afterSecondSync = ctx.subscriptionRepository.findById(subscription.id)!;
    expect(afterSecondSync.activeReleaseId).toBe(activeRelease.id);
    expect(ctx.subscriptionRepository.listReleases(subscription.id)).toHaveLength(1);
    expect(
      ctx.subscriptionService.deliver(subscription.id, token.token, "token", null, null).yamlText
    ).toBe(deliveredBefore);
    expect(deliveredBefore).toContain(oldHash);
    expect(deliveredBefore).not.toContain(newHash);
  });

  test("当前订阅规则同步校验 owner、catalog 可见性与 latest snapshot", () => {
    const ctx = createTestContext();
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "日常",
      sourceIds: [ctx.source.id],
      start: { kind: "recommended" }
    });
    const otherUserId = createUser(ctx.db, "bob");
    const invisible = ctx.rulesetRepository.createUserCatalog({
      id: "rsc_invisible",
      ownerUserId: otherUserId,
      slug: "invisible",
      name: "不可见规则",
      description: null,
      sourceUrl: "https://example.invalid/invisible.yaml",
      behavior: "classical",
      recommendedTarget: null
    });
    const noLatest = ctx.rulesetRepository.createUserCatalog({
      id: "rsc_no_latest",
      ownerUserId: ctx.userId,
      slug: "no-latest",
      name: "尚无快照",
      description: null,
      sourceUrl: "https://example.invalid/no-latest.yaml",
      behavior: "classical",
      recommendedTarget: null
    });
    const missingSnapshot = ctx.rulesetRepository.createUserCatalog({
      id: "rsc_missing_snapshot",
      ownerUserId: ctx.userId,
      slug: "missing-snapshot",
      name: "缺失快照",
      description: null,
      sourceUrl: "https://example.invalid/missing.yaml",
      behavior: "classical",
      recommendedTarget: null
    });
    ctx.rulesetRepository.setLatestSnapshot(missingSnapshot.id, "hash_does_not_exist", true);

    const sharedHashCatalog = ctx.rulesetRepository.createUserCatalog({
      id: "rsc_shared_hash",
      ownerUserId: ctx.userId,
      slug: "shared-hash",
      name: "共享内容快照",
      description: null,
      sourceUrl: "https://example.invalid/shared.yaml",
      behavior: "classical",
      recommendedTarget: null
    });
    const openai = ctx.rulesetService
      .list(ctx.userId)
      .find((entry) => entry.slug === "openai")!;
    ctx.rulesetRepository.setLatestSnapshot(
      sharedHashCatalog.id,
      openai.latestSnapshotHash!,
      true
    );

    const draft = structuredClone(
      ctx.subscriptionRepository.findById(subscription.id)!.draftBuildConfig!
    );
    const originalCatalogCount = new Set(
      draft.rules.targets.flatMap((block) =>
        block.items
          .filter((item) => item.kind === "snapshot")
          .map((item) => item.catalogId)
      )
    ).size;
    const openaiBlock = draft.rules.targets.find((block) => block.target === "OpenAI")!;
    openaiBlock.items.push(
      {
        kind: "snapshot",
        catalogId: invisible.id,
        slug: invisible.slug,
        hash: "hash_invisible_current",
        emit: "provider"
      },
      {
        kind: "snapshot",
        catalogId: noLatest.id,
        slug: noLatest.slug,
        hash: "hash_no_latest_current",
        emit: "provider"
      },
      {
        kind: "snapshot",
        catalogId: missingSnapshot.id,
        slug: missingSnapshot.slug,
        hash: "hash_missing_current",
        emit: "provider"
      },
      {
        kind: "snapshot",
        catalogId: sharedHashCatalog.id,
        slug: sharedHashCatalog.slug,
        hash: "hash_shared_current",
        emit: "provider"
      }
    );
    ctx.subscriptionRepository.saveDraft(subscription.id, draft);

    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("sync latest 不应抓取远端");
    }) as typeof fetch;
    let result: ReturnType<typeof ctx.subscriptionService.syncRulesetsToLatest>;
    try {
      result = ctx.subscriptionService.syncRulesetsToLatest(
        ctx.userId,
        subscription.id,
        ctx.subscriptionRepository.findById(subscription.id)!.draftRevision
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    const {
      buildConfig: syncedBuildConfig,
      draftRevision: syncedDraftRevision,
      ...resultSummary
    } = result;
    expect(resultSummary).toEqual({
      changes: [
        {
          catalogId: sharedHashCatalog.id,
          slug: sharedHashCatalog.slug,
          fromHashes: ["hash_shared_current"],
          toHash: openai.latestSnapshotHash,
          updatedReferenceCount: 1
        }
      ],
      unchangedCount: originalCatalogCount,
      skipped: [
        {
          catalogId: invisible.id,
          slug: invisible.slug,
          reason: "catalog-not-visible"
        },
        {
          catalogId: noLatest.id,
          slug: noLatest.slug,
          reason: "latest-snapshot-unavailable"
        },
        {
          catalogId: missingSnapshot.id,
          slug: missingSnapshot.slug,
          reason: "latest-snapshot-missing"
        }
      ]
    });
    expect(fetchCalls).toBe(0);
    const syncedSharedItem = ctx.subscriptionRepository
      .findById(subscription.id)!
      .draftBuildConfig!.rules.targets.flatMap((block) => block.items)
      .find(
        (item) => item.kind === "snapshot" && item.catalogId === sharedHashCatalog.id
      );
    expect(syncedSharedItem?.hash).toBe(openai.latestSnapshotHash);
    expect(syncedBuildConfig).toEqual(
      ctx.subscriptionRepository.findById(subscription.id)!.draftBuildConfig
    );
    expect(syncedDraftRevision).toBe(
      ctx.subscriptionRepository.findById(subscription.id)!.draftRevision
    );

    try {
      ctx.subscriptionService.syncRulesetsToLatest(otherUserId, subscription.id, 0);
      throw new Error("expected owner validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(SubscriptionError);
      expect((error as SubscriptionError).status).toBe(404);
    }
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
    expect(hit.target).toBe("OpenAI");
    expect(hit.matched?.ruleText).toContain("RULE-SET,openai");

    const anthropicCdn = ctx.subscriptionService.trace(
      ctx.userId,
      subscription.id,
      "servd-anthropic-website.b-cdn.net",
      false
    );
    expect(anthropicCdn.verdict).toBe("hit");
    expect(anthropicCdn.target).toBe("Anthropic");

    const claudePlatform = ctx.subscriptionService.trace(
      ctx.userId,
      subscription.id,
      "platform.claude.com",
      false
    );
    expect(claudePlatform.verdict).toBe("hit");
    expect(claudePlatform.target).toBe("Anthropic");

    // router.asus.com 命中 Lan 规则组，直连
    const direct = ctx.subscriptionService.trace(
      ctx.userId,
      subscription.id,
      "router.asus.com",
      false
    );
    expect(direct.verdict).toBe("hit");
    expect(direct.target).toBe("DIRECT");

    // 兜底断言用一个不落入任何 CIDR/域名规则集的公共 IP
    const fallback = ctx.subscriptionService.trace(ctx.userId, subscription.id, "8.8.8.8", false);
    expect(fallback.verdict).toBe("final");
    expect(fallback.target).toBe("Final");
    expect(fallback.maybeNotes.some((note) => note.includes("GEOIP,CN,no-resolve"))).toBe(
      true
    );
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

  test("含敏感信息模板只在独立密文表保存，并在确认后复制给应用者", () => {
    const ctx = createTestContext();
    const base = instantiateTemplate(
      ctx.templateRepository.findLatestPayload(RECOMMENDED_TEMPLATE_ID)!,
      [ctx.source.id]
    );
    base.nodes.custom.push({
      id: "cn_shared",
      name: "Shared VPS",
      type: "trojan",
      server: "shared.test",
      port: 443,
      secretRef: ctx.secretStore.create(ctx.userId, { password: "template-secret" }),
      extra: {}
    });
    const extracted = extractTemplate(base, { retainSensitive: true });
    if (!("payload" in extracted)) throw new Error("extract failed");
    const template = ctx.templateRepository.create({
      ownerUserId: ctx.userId,
      displayName: "含凭据模板",
      description: null,
      visibility: "public",
      payload: extracted.payload,
      extractionReport: extracted.report,
      versionNote: null,
      embeddedSecrets: new Map([["cn_shared", { password: "template-secret" }]])
    });
    expect(template.embeddedSecrets).toBe(true);
    expect(JSON.stringify(template)).not.toContain("template-secret");

    const bob = createUser(ctx.db, "template-bob");
    const bobSource = ctx.sourceService.createFromUpload(bob, {
      displayName: "Bob source",
      yamlContent: sourceYaml(defaultNodes)
    });
    expect(() => ctx.subscriptionService.create(bob, {
      displayName: "未确认",
      sourceIds: [bobSource.id],
      start: { kind: "template", templateId: template.id }
    })).toThrow("需要明确确认");

    const created = ctx.subscriptionService.create(bob, {
      displayName: "已确认",
      sourceIds: [bobSource.id],
      start: { kind: "template", templateId: template.id, confirmSensitive: true }
    });
    const copiedNode = created.subscription.draftBuildConfig!.nodes.custom.find(
      (node) => node.id === "cn_shared"
    )!;
    expect(copiedNode.secretRef).not.toBeNull();
    expect(ctx.secretStore.resolveForOwner(bob, copiedNode.secretRef!)).toEqual({
      password: "template-secret"
    });
    expect(ctx.secretStore.resolveForOwner(ctx.userId, copiedNode.secretRef!)).toBeNull();
  });
});

// ── 自建节点字段拆分（用户只填一张表单，敏感字段加密下沉后端） ───

describe("SecretStore.upsertSplit", () => {
  test("草稿与历史脏配置都不得引用他人 secretRef", () => {
    const ctx = createTestContext();
    const otherUserId = createUser(ctx.db, "secret-owner-bob");
    const foreignSecret = ctx.secretStore.create(otherUserId, { password: "foreign" });
    const { subscription } = ctx.subscriptionService.create(ctx.userId, {
      displayName: "敏感字段越权门禁",
      sourceIds: [ctx.source.id],
      start: { kind: "recommended" }
    });
    const record = ctx.subscriptionRepository.findById(subscription.id)!;
    const maliciousDraft = structuredClone(record.draftBuildConfig!);
    maliciousDraft.nodes.custom.push({
      id: "cn_foreign",
      name: "Foreign Secret",
      type: "trojan",
      server: "foreign.test",
      port: 443,
      secretRef: foreignSecret,
      extra: {}
    });

    expect(() =>
      ctx.subscriptionService.saveDraft(
        ctx.userId,
        subscription.id,
        maliciousDraft,
        record.draftRevision
      )
    ).toThrow("无权访问的敏感字段");

    // 模拟新门禁上线前已落库的脏数据；预览也必须 fail closed。
    ctx.subscriptionRepository.saveDraft(subscription.id, maliciousDraft);
    expect(() => ctx.subscriptionService.preview(ctx.userId, subscription.id)).toThrow(
      "无权访问的敏感字段"
    );
  });

  test("新建：有敏感字段时创建加密记录，extra 只含非敏感字段", () => {
    const ctx = createTestContext();
    const result = ctx.secretStore.upsertSplit(
      ctx.userId,
      "trojan",
      { password: "home-secret", sni: "home.test", "skip-cert-verify": true },
      null
    );
    expect(result.secretRef).not.toBeNull();
    expect(result.extra).toEqual({ sni: "home.test", "skip-cert-verify": true });
    expect(ctx.secretStore.resolveForOwner(ctx.userId, result.secretRef!)).toEqual({
      password: "home-secret"
    });
  });

  test("新建：全无敏感字段时不创建记录，secretRef 为 null", () => {
    const ctx = createTestContext();
    const result = ctx.secretStore.upsertSplit(ctx.userId, "http", { headers: { "X-Foo": "bar" } }, null);
    expect(result.secretRef).toBeNull();
    expect(result.extra).toEqual({ headers: { "X-Foo": "bar" } });
  });

  test("编辑：已有 secretRef 时 copy-on-write 保留历史密文", () => {
    const ctx = createTestContext();
    const created = ctx.secretStore.upsertSplit(ctx.userId, "trojan", { password: "old-pass" }, null);
    const updated = ctx.secretStore.upsertSplit(
      ctx.userId,
      "trojan",
      { password: "new-pass", sni: "home.test" },
      created.secretRef
    );
    expect(updated.secretRef).not.toBe(created.secretRef!);
    expect(ctx.secretStore.resolveForOwner(ctx.userId, updated.secretRef!)).toEqual({
      password: "new-pass"
    });
    expect(ctx.secretStore.resolveForOwner(ctx.userId, created.secretRef!)).toEqual({
      password: "old-pass"
    });
  });

  test("编辑：敏感字段被清空后 secretRef 归 null 但保留历史密文", () => {
    const ctx = createTestContext();
    const created = ctx.secretStore.upsertSplit(ctx.userId, "trojan", { password: "old-pass" }, null);
    const cleared = ctx.secretStore.upsertSplit(ctx.userId, "trojan", { sni: "home.test" }, created.secretRef);
    expect(cleared.secretRef).toBeNull();
    expect(ctx.secretStore.resolveForOwner(ctx.userId, created.secretRef!)).toEqual({
      password: "old-pass"
    });
  });

  test("resolveForOwner 对非本人记录返回 null", () => {
    const ctx = createTestContext();
    const otherUserId = createUser(ctx.db, "bob");
    const created = ctx.secretStore.upsertSplit(ctx.userId, "trojan", { password: "secret" }, null);
    expect(ctx.secretStore.resolveForOwner(otherUserId, created.secretRef!)).toBeNull();
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
