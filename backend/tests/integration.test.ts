import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import yaml from "js-yaml";

import { seedBuiltinRulesetCatalog } from "../src/lib/db/seed-ruleset-catalog";
import { seedBuiltinTemplates } from "../src/lib/db/seed-builtin-templates";
import { createId } from "../src/lib/ids";
import type { RuntimeConfig } from "../src/lib/runtime-config";
import { AuthError, AuthService } from "../src/modules/auth/auth.service";
import { GeneratedSubscriptionDraftService } from "../src/modules/generated-subscription-drafts/generated-subscription-draft.service";
import { GeneratedSubscriptionDraftRepository } from "../src/modules/generated-subscription-drafts/generated-subscription-draft.repository";
import { MarketplaceRepository } from "../src/modules/marketplace/marketplace.repository";
import { ManagedSubscriptionRepository } from "../src/modules/subscriptions/managed-subscription.repository";
import { ManagedSubscriptionService } from "../src/modules/subscriptions/managed-subscription.service";
import { SubscriptionAccessRepository } from "../src/modules/subscriptions/subscription-access.repository";
import { TemplateRepository } from "../src/modules/templates/template.repository";
import { UpstreamSourceRepository } from "../src/modules/upstream-sources/upstream-source.repository";
import { UpstreamSourceService } from "../src/modules/upstream-sources/upstream-source.service";

const migrationsDir = resolve(import.meta.dir, "../migrations");

const applyMigrations = (db: Database) => {
  for (const fileName of readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort()) {
    db.exec(readFileSync(resolve(migrationsDir, fileName), "utf-8"));
  }
};

const createRuntimeConfig = (): RuntimeConfig => ({
  port: 3001,
  databasePath: ":memory:",
  migrationsDir,
  defaultLocale: "zh-CN",
  jwtSecret: "test-jwt-secret",
  jwtIssuer: "proxyparser-test",
  jwtAccessTtlSeconds: 15 * 60,
  jwtRefreshTtlSeconds: 7 * 24 * 60 * 60,
  subscriptionTempTokenTtlSeconds: 24 * 60 * 60
});

const createTestContext = () => {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  applyMigrations(db);
  seedBuiltinRulesetCatalog(db);
  seedBuiltinTemplates(db);

  const authService = new AuthService(db, createRuntimeConfig());
  const upstreamSourceRepository = new UpstreamSourceRepository(db);
  const upstreamSourceService = new UpstreamSourceService(upstreamSourceRepository);
  const templateRepository = new TemplateRepository(db);
  const marketplaceRepository = new MarketplaceRepository(db);
  const generatedSubscriptionDraftService = new GeneratedSubscriptionDraftService(
    new GeneratedSubscriptionDraftRepository(db),
    upstreamSourceRepository,
    upstreamSourceService,
    marketplaceRepository,
    templateRepository
  );
  const managedSubscriptionService = new ManagedSubscriptionService(
    new ManagedSubscriptionRepository(db),
    upstreamSourceRepository,
    upstreamSourceService,
    templateRepository,
    new SubscriptionAccessRepository(db),
    generatedSubscriptionDraftService
  );

  return {
    db,
    authService,
    upstreamSourceRepository,
    upstreamSourceService,
    templateRepository,
    generatedSubscriptionDraftService,
    managedSubscriptionService
  };
};

const createSourceDocument = () => ({
  "mixed-port": 7890,
  proxies: [
    {
      name: "HK-01",
      type: "ss",
      server: "1.1.1.1",
      port: 443,
      cipher: "aes-128-gcm",
      password: "secret"
    }
  ],
  "proxy-groups": [
    {
      name: "Proxy",
      type: "select",
      proxies: ["HK-01", "DIRECT"]
    }
  ],
  rules: ["MATCH,Proxy"]
});

const seedSuccessfulSourceSnapshot = (
  repository: UpstreamSourceRepository,
  sourceId: string,
  document = createSourceDocument()
) => {
  const createdAt = new Date().toISOString();
  const snapshotId = createId("snap");
  const headers = {
    "subscription-userinfo": "upload=1; download=2; total=3; expire=4"
  };

  repository.createSnapshot({
    id: snapshotId,
    sourceId,
    rawContent: yaml.dump(document),
    parsedJson: JSON.stringify(document),
    responseHeadersJson: JSON.stringify(headers),
    contentHash: "test-hash",
    createdAt
  });
  repository.updateSyncResult({
    sourceId,
    status: "success",
    syncedAt: createdAt,
    latestHeadersJson: JSON.stringify(headers),
    lastSuccessfulSnapshotId: snapshotId
  });

  return snapshotId;
};

test("认证主链路可用，并且注销后 refresh token 会失效", async () => {
  const { authService } = createTestContext();
  const registered = await authService.register({
    email: "alice@example.com",
    username: "alice",
    password: "password123",
    displayName: "Alice"
  });

  expect(registered.user.username).toBe("alice");
  expect(registered.subscriptionSecret.length).toBeGreaterThan(20);

  const loginResult = await authService.login({
    login: "alice",
    password: "password123"
  });
  expect(loginResult.user.email).toBe("alice@example.com");

  const refreshed = authService.refresh(loginResult.tokens.refreshToken);
  expect(refreshed.user.id).toBe(loginResult.user.id);

  authService.logout(refreshed.tokens.refreshToken);

  expect(() => authService.refresh(refreshed.tokens.refreshToken)).toThrow(AuthError);
});

test("生成订阅草稿可以预览、提炼模板并发布", async () => {
  const {
    authService,
    upstreamSourceRepository,
    upstreamSourceService,
    templateRepository,
    generatedSubscriptionDraftService,
    managedSubscriptionService
  } = createTestContext();
  const registered = await authService.register({
    email: "wizard@example.com",
    username: "wizard",
    password: "password123"
  });

  const source = upstreamSourceService.create(registered.user.id, {
    displayName: "测试订阅",
    sourceUrl: "http://127.0.0.1:1/unreachable"
  });
  seedSuccessfulSourceSnapshot(upstreamSourceRepository, source.id);

  const draft = await generatedSubscriptionDraftService.create(registered.user.id, {
    displayName: "日常分流",
    upstreamSourceId: source.id
  });

  generatedSubscriptionDraftService.saveStep(registered.user.id, draft.id, {
    stepKey: "groups_rules",
    patchMode: "patch",
    editorMode: "visual",
    operations: {
      appendRules: ["DOMAIN-SUFFIX,example.com,DIRECT"]
    },
    summary: {
      appendRuleCount: 1
    }
  });

  const preview = await generatedSubscriptionDraftService.preview(registered.user.id, draft.id);
  expect(preview.yamlText).toContain("DOMAIN-SUFFIX,example.com,DIRECT");
  expect(preview.stats.ruleCount).toBeGreaterThan(1);

  const extractedTemplate = await generatedSubscriptionDraftService.extractTemplate(
    registered.user.id,
    draft.id,
    {
      displayName: "日常分流模板"
    }
  );
  expect(extractedTemplate.displayName).toBe("日常分流模板");
  expect(extractedTemplate.payload.rulesMode).toBe("full_override");

  const published = await managedSubscriptionService.publishFromDraft(registered.user.id, draft.id, {
    displayName: "日常分流订阅",
    visibility: "private",
    shareMode: "disabled",
    isEnabled: true
  });
  const derivedTemplate = templateRepository.findDetailByIdAndOwner(
    published.templateId,
    registered.user.id
  );
  expect(published.renderMode).toBe("draft");
  expect(published.lastRenderStatus).toBe("success");
  expect(published.renderedYaml).toContain("DOMAIN-SUFFIX,example.com,DIRECT");
  expect(derivedTemplate?.displayName).toBe("日常分流订阅 蓝图");
});

test("订阅拉取在上游同步失败时会回退到最近一次成功快照", async () => {
  const {
    authService,
    upstreamSourceRepository,
    upstreamSourceService,
    generatedSubscriptionDraftService,
    managedSubscriptionService
  } = createTestContext();
  const registered = await authService.register({
    email: "deliver@example.com",
    username: "deliver",
    password: "password123"
  });

  const source = upstreamSourceService.create(registered.user.id, {
    displayName: "回退测试源",
    sourceUrl: "http://127.0.0.1:1/unreachable"
  });
  seedSuccessfulSourceSnapshot(upstreamSourceRepository, source.id);

  const draft = await generatedSubscriptionDraftService.create(registered.user.id, {
    displayName: "回退草稿",
    upstreamSourceId: source.id
  });
  const published = await managedSubscriptionService.publishFromDraft(registered.user.id, draft.id, {
    displayName: "回退订阅",
    isEnabled: true
  });

  generatedSubscriptionDraftService.saveStep(registered.user.id, draft.id, {
    stepKey: "groups_rules",
    patchMode: "patch",
    editorMode: "visual",
    operations: {
      items: [
        {
          type: "add",
          group: {
            name: "BrokenGroup",
            type: "select",
            proxies: ["MissingProxy"]
          }
        }
      ]
    },
    summary: {
      shouldFailOnRender: true
    }
  });

  const delivered = await managedSubscriptionService.deliver(
    published.id,
    registered.subscriptionSecret,
    "127.0.0.1",
    "bun:test"
  );

  expect(delivered.status).toBe("degraded");
  expect(delivered.yamlText).toContain("HK-01");
  expect(delivered.headers["subscription-userinfo"]).toBe("upload=1; download=2; total=3; expire=4");
});

test("product redesign migration exposes shareability and token metadata", () => {
  const { db } = createTestContext();
  const tableColumns = (tableName: string) =>
    db
      .query<{ name: string }>(`PRAGMA table_info(${tableName})`)
      .all()
      .map((column) => column.name);

  const templateColumns = tableColumns("templates");
  const tempTokenColumns = tableColumns("user_subscription_temp_tokens");
  const shareGrantTable = db
    .query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'subscription_share_grants'`
    )
    .get();

  expect(templateColumns).toContain("shareability_status");
  expect(templateColumns).toContain("sanitized_from_template_id");
  expect(templateColumns).toContain("locked_reasons_json");
  expect(tempTokenColumns).toContain("label");
  expect(tempTokenColumns).toContain("revoked_at");
  expect(shareGrantTable).toBeTruthy();
});

test("draft preview auto groups all source nodes into Proxies and regions", async () => {
  const {
    authService,
    upstreamSourceRepository,
    upstreamSourceService,
    generatedSubscriptionDraftService
  } = createTestContext();
  const registered = await authService.register({
    email: "autogroup@example.com",
    username: "autogroup",
    password: "password123"
  });
  const source = upstreamSourceService.create(registered.user.id, {
    displayName: "自动分组源",
    sourceUrl: "http://127.0.0.1:1/unreachable"
  });

  seedSuccessfulSourceSnapshot(upstreamSourceRepository, source.id, {
    proxies: [
      {
        name: "HK-01",
        type: "ss",
        server: "1.1.1.1",
        port: 443,
        cipher: "aes-128-gcm",
        password: "secret"
      },
      {
        name: "JP-01",
        type: "ss",
        server: "2.2.2.2",
        port: 443,
        cipher: "aes-128-gcm",
        password: "secret"
      },
      {
        name: "Mystery-01",
        type: "ss",
        server: "3.3.3.3",
        port: 443,
        cipher: "aes-128-gcm",
        password: "secret"
      }
    ],
    "proxy-groups": [
      {
        name: "Source",
        type: "select",
        proxies: ["HK-01", "JP-01", "Mystery-01"]
      }
    ],
    rules: ["MATCH,Source"]
  });

  const draft = await generatedSubscriptionDraftService.create(registered.user.id, {
    displayName: "自动分组草稿",
    upstreamSourceId: source.id
  });
  generatedSubscriptionDraftService.saveStep(registered.user.id, draft.id, {
    stepKey: "groups_rules",
    patchMode: "patch",
    editorMode: "visual",
    operations: {
      autoGroup: {
        enabled: true,
        includeAutoGroup: true,
        unclassifiedPolicy: "others"
      }
    }
  });

  const preview = await generatedSubscriptionDraftService.preview(registered.user.id, draft.id);
  const groupsByName = new Map(
    preview.document["proxy-groups"].map((group) => [group.name, group] as const)
  );

  expect([...groupsByName.keys()]).toContain("Proxies");
  expect([...groupsByName.keys()]).toContain("HK");
  expect([...groupsByName.keys()]).toContain("JP");
  expect([...groupsByName.keys()]).toContain("Others");
  expect([...groupsByName.keys()]).toContain("Auto");
  expect(groupsByName.get("Proxies")?.proxies).toContain("HK-01");
  expect(groupsByName.get("Proxies")?.proxies).toContain("JP-01");
  expect(groupsByName.get("Proxies")?.proxies).toContain("Mystery-01");
  expect(groupsByName.get("HK")?.proxies).toContain("HK-01");
  expect(groupsByName.get("JP")?.proxies).toContain("JP-01");
  expect(groupsByName.get("Others")?.proxies).toContain("Mystery-01");
});

test("draft preview emits rule providers and RULE-SET rules", async () => {
  const {
    authService,
    upstreamSourceRepository,
    upstreamSourceService,
    generatedSubscriptionDraftService
  } = createTestContext();
  const registered = await authService.register({
    email: "ruleset@example.com",
    username: "ruleset",
    password: "password123"
  });
  const source = upstreamSourceService.create(registered.user.id, {
    displayName: "规则源测试源",
    sourceUrl: "http://127.0.0.1:1/unreachable"
  });

  seedSuccessfulSourceSnapshot(upstreamSourceRepository, source.id);

  const draft = await generatedSubscriptionDraftService.create(registered.user.id, {
    displayName: "规则源草稿",
    upstreamSourceId: source.id
  });
  generatedSubscriptionDraftService.saveStep(registered.user.id, draft.id, {
    stepKey: "groups_rules",
    patchMode: "patch",
    editorMode: "visual",
    operations: {
      autoGroup: {
        enabled: true,
        includeAutoGroup: false,
        unclassifiedPolicy: "others"
      },
      ruleProviderAttachments: [
        {
          type: "attach-rule-provider",
          providerSlug: "metacubex-geosite-openai",
          targetPolicy: "Proxies",
          insert: {
            position: "before-match"
          }
        }
      ],
      rules: ["MATCH,Proxies"]
    }
  });

  const preview = await generatedSubscriptionDraftService.preview(registered.user.id, draft.id);
  const ruleProviders = preview.document["rule-providers"] as Record<string, unknown> | undefined;
  const rules = preview.document.rules ?? [];

  expect(ruleProviders).toBeTruthy();
  expect(Object.keys(ruleProviders ?? {})).toContain("metacubex-geosite-openai");
  expect(preview.yamlText).toContain(
    "/api/marketplace/rulesets/metacubex-geosite-openai/content"
  );
  expect(rules).toContain("RULE-SET,metacubex-geosite-openai,Proxies");
  expect(rules.indexOf("RULE-SET,metacubex-geosite-openai,Proxies")).toBeLessThan(
    rules.indexOf("MATCH,Proxies")
  );
});

test("subscription render replays draft against latest successful upstream snapshot", async () => {
  const {
    authService,
    upstreamSourceRepository,
    upstreamSourceService,
    generatedSubscriptionDraftService,
    managedSubscriptionService
  } = createTestContext();
  const registered = await authService.register({
    email: "latest@example.com",
    username: "latest",
    password: "password123"
  });
  const source = upstreamSourceService.create(registered.user.id, {
    displayName: "最新快照源",
    sourceUrl: "http://127.0.0.1:1/unreachable"
  });

  seedSuccessfulSourceSnapshot(upstreamSourceRepository, source.id, createSourceDocument());

  const draft = await generatedSubscriptionDraftService.create(registered.user.id, {
    displayName: "最新快照草稿",
    upstreamSourceId: source.id
  });
  const published = await managedSubscriptionService.publishFromDraft(registered.user.id, draft.id, {
    displayName: "最新快照订阅",
    isEnabled: true
  });

  seedSuccessfulSourceSnapshot(upstreamSourceRepository, source.id, {
    proxies: [
      {
        name: "HK-02",
        type: "ss",
        server: "9.9.9.9",
        port: 443,
        cipher: "aes-128-gcm",
        password: "secret"
      }
    ],
    "proxy-groups": [
      {
        name: "Proxy",
        type: "select",
        proxies: ["HK-02", "DIRECT"]
      }
    ],
    rules: ["MATCH,Proxy"]
  });

  const rerendered = await managedSubscriptionService.render(registered.user.id, published.id);

  expect(rerendered.renderedYaml).toContain("HK-02");
  expect(rerendered.renderedYaml).not.toContain("HK-01");
});

test("render failure is persisted on subscription", async () => {
  const {
    authService,
    upstreamSourceRepository,
    upstreamSourceService,
    generatedSubscriptionDraftService,
    managedSubscriptionService
  } = createTestContext();
  const registered = await authService.register({
    email: "renderfail@example.com",
    username: "renderfail",
    password: "password123"
  });
  const source = upstreamSourceService.create(registered.user.id, {
    displayName: "失败落库源",
    sourceUrl: "http://127.0.0.1:1/unreachable"
  });
  seedSuccessfulSourceSnapshot(upstreamSourceRepository, source.id);

  const draft = await generatedSubscriptionDraftService.create(registered.user.id, {
    displayName: "失败落库草稿",
    upstreamSourceId: source.id
  });
  const published = await managedSubscriptionService.publishFromDraft(registered.user.id, draft.id, {
    displayName: "失败落库订阅",
    isEnabled: true
  });

  generatedSubscriptionDraftService.saveStep(registered.user.id, draft.id, {
    stepKey: "groups_rules",
    patchMode: "patch",
    editorMode: "visual",
    operations: {
      items: [
        {
          type: "add",
          group: {
            name: "BrokenGroup",
            type: "select",
            proxies: ["MissingProxy"]
          }
        }
      ]
    }
  });

  await expect(managedSubscriptionService.render(registered.user.id, published.id)).rejects.toThrow(
    "MissingProxy"
  );

  const detail = managedSubscriptionService.getById(registered.user.id, published.id);

  expect(detail.lastRenderStatus).toBe("degraded");
  expect(detail.lastErrorMessage).toContain("MissingProxy");
});

test("upstream source rejects invalid URL on update", async () => {
  const { authService, upstreamSourceService } = createTestContext();
  const registered = await authService.register({
    email: "sourceupdate@example.com",
    username: "sourceupdate",
    password: "password123"
  });
  const source = upstreamSourceService.create(registered.user.id, {
    displayName: "可更新订阅",
    sourceUrl: "http://127.0.0.1:1/unreachable"
  });

  expect(() =>
    upstreamSourceService.update(registered.user.id, source.id, {
      sourceUrl: "notaurl"
    })
  ).toThrow("订阅链接必须是 http 或 https 地址。");
});

test("draft can create an upstream source from a pasted URL", async () => {
  const { authService, generatedSubscriptionDraftService, upstreamSourceRepository } =
    createTestContext();
  const registered = await authService.register({
    email: "sourceurl@example.com",
    username: "sourceurl",
    password: "password123"
  });

  const draft = await generatedSubscriptionDraftService.create(registered.user.id, {
    displayName: "粘贴 URL 草稿",
    sourceDisplayName: "粘贴导入源",
    sourceUrl: "http://127.0.0.1:1/unreachable"
  });

  expect(draft.upstreamSourceId).toBeTruthy();

  const source = upstreamSourceRepository.findByIdAndOwner(
    draft.upstreamSourceId ?? "",
    registered.user.id
  );

  expect(source?.displayName).toBe("粘贴导入源");
  expect(source?.lastSyncStatus).toBe("failed");
});
