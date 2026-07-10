import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { getRuntimeConfig } from "../src/lib/runtime-config";
import { loadOrCreateSecretBox, SecretBox } from "../src/lib/security/secret-box";
import type { EventRepository } from "../src/modules/events/event.repository";
import type { RulesetRepository } from "../src/modules/rulesets/ruleset.repository";
import type { SecretStore } from "../src/modules/subscriptions/secret-store";
import type {
  SubscriptionRecord,
  SubscriptionRepository
} from "../src/modules/subscriptions/subscription.repository";
import { SubscriptionService } from "../src/modules/subscriptions/subscription.service";
import type { TemplateRepository } from "../src/modules/templates/template.repository";
import type {
  SourceRecord,
  UpstreamSourceRepository
} from "../src/modules/upstream-sources/upstream-source.repository";
import { UpstreamSourceService } from "../src/modules/upstream-sources/upstream-source.service";

const ENV_KEYS = [
  "DATABASE_PATH",
  "PP_SECRET_KEY",
  "SUBSCRIPTION_TEMP_TOKEN_TTL_SECONDS",
  "SOURCE_SYNC_INTERVAL_MINUTES"
] as const;

const originalEnvironment = new Map(
  ENV_KEYS.map((key) => [key, process.env[key]] as const)
);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = originalEnvironment.get(key);
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});

describe("运行时配置", () => {
  test("默认数据库名不包含版本号", () => {
    delete process.env.DATABASE_PATH;

    const config = getRuntimeConfig();

    expect(config.databasePath).toBe(resolve(import.meta.dir, "../data/proxyparser.sqlite"));
    expect(config.dataDir).toBe(resolve(import.meta.dir, "../data"));
  });

  test("自动生成的加密密钥与数据库落在同一持久化目录并可复用", () => {
    const dataDir = mkdtempSync(resolve(tmpdir(), "proxyparser-runtime-"));
    process.env.DATABASE_PATH = resolve(dataDir, "proxyparser.sqlite");
    delete process.env.PP_SECRET_KEY;

    try {
      const config = getRuntimeConfig();
      expect(config.dataDir).toBe(dataDir);

      const first = loadOrCreateSecretBox({ secretKeyHex: null, dataDir: config.dataDir });
      const ciphertext = first.encrypt({ password: "persisted" });
      const second = loadOrCreateSecretBox({ secretKeyHex: null, dataDir: config.dataDir });

      expect(existsSync(resolve(dataDir, ".secret-key"))).toBe(true);
      expect(second.decrypt(ciphertext)).toEqual({ password: "persisted" });
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("读取短期链接和订阅源同步默认值", () => {
    process.env.SUBSCRIPTION_TEMP_TOKEN_TTL_SECONDS = "7200";
    process.env.SOURCE_SYNC_INTERVAL_MINUTES = "90";

    const config = getRuntimeConfig();

    expect(config.subscriptionTempTokenTtlSeconds).toBe(7200);
    expect(config.sourceSyncDefaultIntervalMinutes).toBe(90);
  });

  test("拒绝业务允许范围外的默认值", () => {
    process.env.SUBSCRIPTION_TEMP_TOKEN_TTL_SECONDS = "3599";
    expect(() => getRuntimeConfig()).toThrow("SUBSCRIPTION_TEMP_TOKEN_TTL_SECONDS");

    process.env.SUBSCRIPTION_TEMP_TOKEN_TTL_SECONDS = "7200";
    process.env.SOURCE_SYNC_INTERVAL_MINUTES = "10081";
    expect(() => getRuntimeConfig()).toThrow("SOURCE_SYNC_INTERVAL_MINUTES");
  });
});

describe("运行时默认值接线", () => {
  test("新建 URL 订阅源使用配置的默认同步间隔", async () => {
    let record: SourceRecord | null = null;
    const repository = {
      create(input: Parameters<UpstreamSourceRepository["create"]>[0]) {
        const now = new Date().toISOString();
        record = {
          ...input,
          isEnabled: true,
          nextSyncAt: now,
          lastSyncStatus: "idle",
          lastSyncAt: null,
          lastSuccessfulSyncAt: null,
          lastFailedSyncAt: null,
          lastErrorMessage: null,
          lastSuccessfulSnapshotId: null,
          headers: {},
          usage: null,
          createdAt: now,
          updatedAt: now
        };
        return record;
      },
      findById() {
        return record;
      },
      findByIdAndOwner() {
        return record;
      },
      tryBeginSync() {
        return false;
      }
    } as unknown as UpstreamSourceRepository;
    const service = new UpstreamSourceService(
      repository,
      {} as EventRepository,
      { defaultSyncIntervalMinutes: 90 }
    );

    const created = await service.create("user_alice", {
      displayName: "机场",
      sourceUrl: "https://example.com/subscription"
    });

    expect(created.syncIntervalMinutes).toBe(90);
  });

  test("省略短期链接 TTL 时使用配置的默认值", () => {
    const now = new Date().toISOString();
    const subscription: SubscriptionRecord = {
      id: "sub_test",
      ownerUserId: "user_alice",
      displayName: "日常",
      isEnabled: true,
      buildConfig: null,
      draftBuildConfig: null,
      activeReleaseId: null,
      publishPolicy: "confirm",
      pendingUpstreamChange: false,
      health: "ok",
      healthReasons: [],
      headers: {},
      usage: null,
      createdAt: now,
      updatedAt: now
    };
    let expiresAt = "";
    const repository = {
      findByIdAndOwner() {
        return subscription;
      },
      createTempToken(input: Parameters<SubscriptionRepository["createTempToken"]>[0]) {
        expiresAt = input.expiresAt;
        return {
          id: "tmp_test",
          subscriptionId: input.subscriptionId,
          label: input.label,
          rotatedFromId: null,
          revokedAt: null,
          lastUsedAt: null,
          expiresAt: input.expiresAt,
          createdAt: now
        };
      }
    } as unknown as SubscriptionRepository;
    const service = new SubscriptionService(
      repository,
      {} as UpstreamSourceRepository,
      {} as RulesetRepository,
      {} as TemplateRepository,
      {} as EventRepository,
      {} as SecretStore,
      new SecretBox(randomBytes(32)),
      {
        publicBaseUrl: "https://proxyparser.test",
        tempTokenTtlSeconds: 7200,
        mihomo: {
          mihomoPath: null,
          dataDir: "/nonexistent",
          assetsDir: "/nonexistent"
        }
      }
    );
    const before = Date.now();

    service.createTempToken("user_alice", subscription.id, { label: null });

    const actualExpiry = Date.parse(expiresAt);
    expect(actualExpiry).toBeGreaterThanOrEqual(before + 7200 * 1000);
    expect(actualExpiry).toBeLessThanOrEqual(Date.now() + 7200 * 1000);
  });
});
