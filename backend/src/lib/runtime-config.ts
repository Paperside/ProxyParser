import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface RuntimeConfig {
  host: string;
  port: number;
  databasePath: string;
  migrationsDir: string;
  assetsDir: string;
  secretDataDir: string;
  mihomoDataDir: string;
  publicBaseUrl: string;
  mihomoPath: string | null;
  secretKey: string | null;
  defaultLocale: string;
  jwtSecret: string;
  jwtIssuer: string;
  jwtAccessTtlSeconds: number;
  jwtRefreshTtlSeconds: number;
  subscriptionTempTokenTtlSeconds: number;
  sourceSyncDefaultIntervalMinutes: number;
  rulesetCheckIntervalMinutes: number;
  latencyTestUrl: string;
  latencyTimeoutMs: number;
}

const runtimeDir = dirname(fileURLToPath(import.meta.url));
const backendRootDir = resolve(runtimeDir, "../..");
const DATABASE_FILE_NAME = "proxyparser.sqlite";
const VERSIONED_DATABASE_FILE_NAME = "proxyparser.v2.sqlite";

const readNumberEnv = (name: string, fallback: number) => {
  const rawValue = process.env[name];

  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive number.`);
  }

  return parsed;
};

const readNumberEnvInRange = (
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
) => {
  const value = readNumberEnv(name, fallback);

  if (value < minimum || value > maximum) {
    throw new Error(
      `Environment variable ${name} must be between ${minimum} and ${maximum}.`
    );
  }

  return value;
};

const resolveDatabasePath = () => {
  const configuredPath = process.env.DATABASE_PATH;

  if (!configuredPath) {
    return resolve(backendRootDir, "data", DATABASE_FILE_NAME);
  }

  return isAbsolute(configuredPath)
    ? configuredPath
    : resolve(backendRootDir, configuredPath);
};

const assertNoVersionedDatabaseSibling = (databasePath: string) => {
  if (basename(databasePath) !== DATABASE_FILE_NAME) {
    return;
  }

  const versionedPath = resolve(dirname(databasePath), VERSIONED_DATABASE_FILE_NAME);
  const versionedArtifacts = [
    versionedPath,
    `${versionedPath}-wal`,
    `${versionedPath}-shm`
  ].filter((path) => existsSync(path));
  if (versionedArtifacts.length === 0) {
    return;
  }

  throw new Error(
    [
      `检测到旧数据库文件 ${versionedArtifacts.join("、")}，但当前数据库目标是 ${databasePath}。`,
      "为避免静默创建空库或在两个数据库之间产生歧义，ProxyParser 已停止启动。",
      "请先停止所有 ProxyParser 进程并备份整个数据目录，再人工迁移 SQLite 数据库及其 -wal/-shm 伴随文件；程序不会自动搬移 WAL。",
      `若要暂时继续使用旧文件，请显式设置 DATABASE_PATH=${versionedPath}。`
    ].join(" ")
  );
};

export const getRuntimeConfig = (): RuntimeConfig => {
  const port = readNumberEnv("PORT", 3001);
  const databasePath = resolveDatabasePath();
  assertNoVersionedDatabaseSibling(databasePath);

  return {
    host: process.env.HOST ?? "0.0.0.0",
    port,
    databasePath,
    migrationsDir: resolve(backendRootDir, "migrations"),
    assetsDir: resolve(backendRootDir, "assets"),
    // 密钥跟随数据库持久化；mihomo 仍使用仓库内 backend/data 的 bundled binary。
    secretDataDir: dirname(databasePath),
    mihomoDataDir: resolve(backendRootDir, "data"),
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`,
    mihomoPath: process.env.PROXYPARSER_MIHOMO_PATH ?? null,
    secretKey: process.env.PP_SECRET_KEY ?? null,
    defaultLocale: process.env.DEFAULT_LOCALE ?? "zh-CN",
    jwtSecret: process.env.JWT_SECRET ?? "dev-insecure-change-me",
    jwtIssuer: process.env.JWT_ISSUER ?? "proxyparser",
    jwtAccessTtlSeconds: readNumberEnv("JWT_ACCESS_TTL_SECONDS", 15 * 60),
    jwtRefreshTtlSeconds: readNumberEnv("JWT_REFRESH_TTL_SECONDS", 30 * 24 * 60 * 60),
    subscriptionTempTokenTtlSeconds: readNumberEnvInRange(
      "SUBSCRIPTION_TEMP_TOKEN_TTL_SECONDS",
      24 * 60 * 60,
      60 * 60,
      30 * 24 * 60 * 60
    ),
    sourceSyncDefaultIntervalMinutes: readNumberEnvInRange(
      "SOURCE_SYNC_INTERVAL_MINUTES",
      360,
      15,
      7 * 24 * 60
    ),
    rulesetCheckIntervalMinutes: readNumberEnv("RULESET_CHECK_INTERVAL_MINUTES", 24 * 60),
    latencyTestUrl: process.env.LATENCY_TEST_URL ?? "https://cp.cloudflare.com/generate_204",
    latencyTimeoutMs: readNumberEnvInRange("LATENCY_TIMEOUT_MS", 5_000, 1_000, 30_000)
  };
};

export const ensureRuntimeDirectories = (config = getRuntimeConfig()) => {
  mkdirSync(dirname(config.databasePath), {
    recursive: true
  });
};
