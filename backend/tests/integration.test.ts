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

  const draft = generatedSubscriptionDraftService.create(registered.user.id, {
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

  const draft = generatedSubscriptionDraftService.create(registered.user.id, {
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
