import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { getRuntimeConfig } from "../src/lib/runtime-config";
import {
  createOrReadSecretKeyFile,
  loadOrCreateSecretBox,
  SecretBox,
  verifySecretBoxCiphertexts
} from "../src/lib/security/secret-box";
import {
  assertKnownDatabaseBeforeMigrations,
  listEncryptedSecretRecords
} from "../src/lib/db";
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
    expect(config.secretDataDir).toBe(resolve(import.meta.dir, "../data"));
    expect(config.mihomoDataDir).toBe(resolve(import.meta.dir, "../data"));
  });

  test("无版本数据库旁存在 v2 文件时 fail-fast，显式指向 v2 仍允许", () => {
    const dataDir = mkdtempSync(resolve(tmpdir(), "proxyparser-database-cutover-"));
    const versionedPath = resolve(dataDir, "proxyparser.v2.sqlite");
    const unversionedPath = resolve(dataDir, "proxyparser.sqlite");
    writeFileSync(versionedPath, "legacy-next-database");

    try {
      process.env.DATABASE_PATH = unversionedPath;
      expect(() => getRuntimeConfig()).toThrow("不会自动搬移 WAL");
      expect(existsSync(unversionedPath)).toBe(false);

      process.env.DATABASE_PATH = versionedPath;
      expect(getRuntimeConfig().databasePath).toBe(versionedPath);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("v2 主文件已移走但遗留 WAL/SHM 时仍 fail-fast", () => {
    const dataDir = mkdtempSync(resolve(tmpdir(), "proxyparser-database-sidecar-"));
    const versionedPath = resolve(dataDir, "proxyparser.v2.sqlite");
    const unversionedPath = resolve(dataDir, "proxyparser.sqlite");
    process.env.DATABASE_PATH = unversionedPath;

    try {
      for (const suffix of ["-wal", "-shm"]) {
        const sidecarPath = `${versionedPath}${suffix}`;
        writeFileSync(sidecarPath, "orphaned-sidecar");
        expect(() => getRuntimeConfig()).toThrow(sidecarPath);
        expect(existsSync(unversionedPath)).toBe(false);
        rmSync(sidecarPath, { force: true });
      }
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("已有用户表但无迁移标记的未知数据库在写入前 fail-fast", () => {
    const empty = new Database(":memory:");
    expect(() =>
      assertKnownDatabaseBeforeMigrations(empty, "empty.sqlite")
    ).not.toThrow();
    expect(
      empty
        .query<{ count: number }>(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE name = '_schema_migrations'"
        )
        .get()?.count
    ).toBe(0);
    empty.close();

    const legacy = new Database(":memory:");
    legacy.exec("CREATE TABLE legacy_subscriptions (id TEXT PRIMARY KEY)");
    expect(() =>
      assertKnownDatabaseBeforeMigrations(legacy, "legacy-proxyparser.sqlite")
    ).toThrow("缺少 _schema_migrations 迁移标记");
    expect(
      legacy
        .query<{ count: number }>(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE name = '_schema_migrations'"
        )
        .get()?.count
    ).toBe(0);
    legacy.close();

    const known = new Database(":memory:");
    known.exec(
      "CREATE TABLE _schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
    );
    expect(() =>
      assertKnownDatabaseBeforeMigrations(known, "known-proxyparser.sqlite")
    ).not.toThrow();
    known.close();

    const suspicious = new Database(":memory:");
    suspicious.exec(`
      CREATE TABLE _schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE legacy_subscriptions (id TEXT PRIMARY KEY);
    `);
    expect(() =>
      assertKnownDatabaseBeforeMigrations(suspicious, "suspicious.sqlite")
    ).toThrow("没有已应用的 0001_schema.sql");
    suspicious.close();
  });

  test("自定义数据库路径只改变密钥目录，不改变 bundled mihomo 目录", () => {
    const dataDir = mkdtempSync(resolve(tmpdir(), "proxyparser-custom-database-"));
    process.env.DATABASE_PATH = resolve(dataDir, "custom.sqlite");

    try {
      const config = getRuntimeConfig();
      expect(config.secretDataDir).toBe(dataDir);
      expect(config.mihomoDataDir).toBe(resolve(import.meta.dir, "../data"));
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("自动生成的加密密钥与数据库落在同一持久化目录并可复用", () => {
    const dataDir = mkdtempSync(resolve(tmpdir(), "proxyparser-runtime-"));
    process.env.DATABASE_PATH = resolve(dataDir, "proxyparser.sqlite");
    delete process.env.PP_SECRET_KEY;

    try {
      const config = getRuntimeConfig();
      expect(config.secretDataDir).toBe(dataDir);

      const first = loadOrCreateSecretBox({
        secretKeyHex: null,
        dataDir: config.secretDataDir
      });
      const ciphertext = first.encrypt({ password: "persisted" });
      const second = loadOrCreateSecretBox({
        secretKeyHex: null,
        dataDir: config.secretDataDir,
        requireExistingKey: true
      });

      expect(existsSync(resolve(dataDir, ".secret-key"))).toBe(true);
      expect(second.decrypt(ciphertext)).toEqual({ password: "persisted" });
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("密钥只接受严格 64 位 hex", () => {
    const dataDir = mkdtempSync(resolve(tmpdir(), "proxyparser-invalid-key-"));
    const keyPath = resolve(dataDir, ".secret-key");

    try {
      for (const invalid of ["a".repeat(65), `${"a".repeat(64)}z`, "g".repeat(64)]) {
        expect(() =>
          loadOrCreateSecretBox({ secretKeyHex: invalid, dataDir })
        ).toThrow("PP_SECRET_KEY 必须是 64 位 hex");
      }

      writeFileSync(keyPath, "b".repeat(65));
      expect(() =>
        loadOrCreateSecretBox({ secretKeyHex: null, dataDir })
      ).toThrow("内容非法");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("并发首创密钥发生 EEXIST 时采用已经落盘的赢家", () => {
    const dataDir = mkdtempSync(resolve(tmpdir(), "proxyparser-key-race-"));
    const keyPath = resolve(dataDir, ".secret-key");
    const winner = randomBytes(32);
    const candidate = randomBytes(32);

    try {
      const selected = createOrReadSecretKeyFile(
        keyPath,
        candidate,
        (path, _content, options) => {
          expect(options).toEqual({ mode: 0o600, flag: "wx" });
          writeFileSync(path, winner.toString("hex"), options);
          const error = new Error("simulated concurrent winner") as NodeJS.ErrnoException;
          error.code = "EEXIST";
          throw error;
        }
      );

      expect(selected).toEqual(winner);
      const restored = loadOrCreateSecretBox({ secretKeyHex: null, dataDir });
      const winnerBox = new SecretBox(winner);
      expect(restored.decrypt(winnerBox.encrypt({ winner: true }))).toEqual({ winner: true });

      let readAttempts = 0;
      const retried = createOrReadSecretKeyFile(
        keyPath,
        candidate,
        () => {
          const error = new Error("simulated concurrent writer") as NodeJS.ErrnoException;
          error.code = "EEXIST";
          throw error;
        },
        () => {
          readAttempts += 1;
          if (readAttempts === 1) throw new Error("winner is still writing");
          return winner;
        },
        () => undefined
      );
      expect(readAttempts).toBe(2);
      expect(retried).toEqual(winner);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("显式 PP_SECRET_KEY 与已有文件必须是同一把密钥", () => {
    const dataDir = mkdtempSync(resolve(tmpdir(), "proxyparser-key-split-brain-"));
    const persistedKey = randomBytes(32);
    const otherKey = randomBytes(32);
    writeFileSync(resolve(dataDir, ".secret-key"), persistedKey.toString("hex"), {
      mode: 0o600
    });

    try {
      expect(() =>
        loadOrCreateSecretBox({
          secretKeyHex: otherKey.toString("hex"),
          dataDir
        })
      ).toThrow("PP_SECRET_KEY 与持久化密钥");

      const restored = loadOrCreateSecretBox({
        secretKeyHex: persistedKey.toString("hex").toUpperCase(),
        dataDir
      });
      const expected = new SecretBox(persistedKey);
      expect(restored.decrypt(expected.encrypt({ sameKey: true }))).toEqual({ sameKey: true });
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("已有加密记录需要旧密钥时绝不静默生成新 key", () => {
    const dataDir = mkdtempSync(resolve(tmpdir(), "proxyparser-missing-key-"));

    try {
      expect(() =>
        loadOrCreateSecretBox({
          secretKeyHex: null,
          dataDir,
          requireExistingKey: true
        })
      ).toThrow("数据库包含已有加密记录");
      expect(existsSync(resolve(dataDir, ".secret-key"))).toBe(false);

      const keyHex = randomBytes(32).toString("hex");
      const restored = loadOrCreateSecretBox({
        secretKeyHex: keyHex,
        dataDir,
        requireExistingKey: true
      });
      expect(restored.decrypt(restored.encrypt({ restored: true }))).toEqual({
        restored: true
      });
      expect(existsSync(resolve(dataDir, ".secret-key"))).toBe(false);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("启动保护遍历长期/短期 token 等全部密文并拒绝 mixed-key 或损坏记录", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE custom_node_secrets (id TEXT PRIMARY KEY, ciphertext BLOB NOT NULL);
      CREATE TABLE subscription_tokens (id TEXT PRIMARY KEY, token_ciphertext BLOB);
      CREATE TABLE subscription_temp_tokens (id TEXT PRIMARY KEY, token_ciphertext BLOB);
    `);
    const correct = new SecretBox(randomBytes(32));
    const customCiphertext = correct.encrypt({ password: "existing" });
    const tokenCiphertext = correct.encrypt({ token: "persisted" });
    const tempTokenCiphertext = correct.encrypt({ token: "temporary" });

    db.query("INSERT INTO custom_node_secrets (id, ciphertext) VALUES (?, ?)").run(
      "sec_existing",
      customCiphertext
    );
    db.query("INSERT INTO subscription_tokens (id, token_ciphertext) VALUES (?, ?)").run(
      "tok_existing",
      tokenCiphertext
    );
    db.query("INSERT INTO subscription_temp_tokens (id, token_ciphertext) VALUES (?, ?)").run(
      "tmp_existing",
      tempTokenCiphertext
    );

    let records = listEncryptedSecretRecords(db);
    expect(records.map((record) => record.kind)).toEqual([
      "custom_node_secret",
      "subscription_temp_token",
      "subscription_token"
    ]);
    expect(() =>
      verifySecretBoxCiphertexts(correct, records.map((record) => record.ciphertext))
    ).not.toThrow();
    expect(() =>
      verifySecretBoxCiphertexts(
        new SecretBox(randomBytes(32)),
        records.map((record) => record.ciphertext)
      )
    ).toThrow("与数据库中的加密记录不匹配");

    const otherKeyCiphertext = new SecretBox(randomBytes(32)).encrypt({ token: "wrong-key" });
    db.query("UPDATE subscription_temp_tokens SET token_ciphertext = ? WHERE id = ?").run(
      otherKeyCiphertext,
      "tmp_existing"
    );
    records = listEncryptedSecretRecords(db);
    expect(() =>
      verifySecretBoxCiphertexts(correct, records.map((record) => record.ciphertext))
    ).toThrow("与数据库中的加密记录不匹配");

    db.query("UPDATE subscription_temp_tokens SET token_ciphertext = ? WHERE id = ?").run(
      tempTokenCiphertext,
      "tmp_existing"
    );
    db.query("UPDATE subscription_tokens SET token_ciphertext = ? WHERE id = ?").run(
      Buffer.from([1, 2, 3]),
      "tok_existing"
    );
    records = listEncryptedSecretRecords(db);
    expect(() =>
      verifySecretBoxCiphertexts(correct, records.map((record) => record.ciphertext))
    ).toThrow("数据库密文已经损坏");
    db.close();
  });

  test("只读历史 fixture 尚无短期密文列时仍可检查已有密文", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE custom_node_secrets (id TEXT PRIMARY KEY, ciphertext BLOB NOT NULL);
      CREATE TABLE subscription_tokens (id TEXT PRIMARY KEY, token_ciphertext BLOB);
      CREATE TABLE subscription_temp_tokens (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL);
    `);
    const secretBox = new SecretBox(randomBytes(32));
    db.query("INSERT INTO custom_node_secrets (id, ciphertext) VALUES (?, ?)").run(
      "sec_existing",
      secretBox.encrypt({ password: "existing" })
    );
    db.query("INSERT INTO subscription_tokens (id, token_ciphertext) VALUES (?, ?)").run(
      "tok_existing",
      secretBox.encrypt({ token: "persisted" })
    );
    db.query("INSERT INTO subscription_temp_tokens (id, token_hash) VALUES (?, ?)").run(
      "tmp_legacy",
      "hash-only"
    );

    expect(listEncryptedSecretRecords(db).map((record) => record.kind)).toEqual([
      "custom_node_secret",
      "subscription_token"
    ]);
    db.close();
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
      draftRevision: 0,
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
