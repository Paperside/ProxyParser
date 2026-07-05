import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface RuntimeConfig {
  host: string;
  port: number;
  databasePath: string;
  migrationsDir: string;
  assetsDir: string;
  dataDir: string;
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
}

const runtimeDir = dirname(fileURLToPath(import.meta.url));
const backendRootDir = resolve(runtimeDir, "../..");

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

const resolveDatabasePath = () => {
  const configuredPath = process.env.DATABASE_PATH;

  if (!configuredPath) {
    // Next 版本全新 schema，与旧 proxyparser.sqlite 彻底切断
    return resolve(backendRootDir, "data", "proxyparser.v2.sqlite");
  }

  return isAbsolute(configuredPath)
    ? configuredPath
    : resolve(backendRootDir, configuredPath);
};

export const getRuntimeConfig = (): RuntimeConfig => {
  const port = readNumberEnv("PORT", 3001);

  return {
    host: process.env.HOST ?? "0.0.0.0",
    port,
    databasePath: resolveDatabasePath(),
    migrationsDir: resolve(backendRootDir, "migrations"),
    assetsDir: resolve(backendRootDir, "assets"),
    dataDir: resolve(backendRootDir, "data"),
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`,
    mihomoPath: process.env.PROXYPARSER_MIHOMO_PATH ?? null,
    secretKey: process.env.PP_SECRET_KEY ?? null,
    defaultLocale: process.env.DEFAULT_LOCALE ?? "zh-CN",
    jwtSecret: process.env.JWT_SECRET ?? "dev-insecure-change-me",
    jwtIssuer: process.env.JWT_ISSUER ?? "proxyparser",
    jwtAccessTtlSeconds: readNumberEnv("JWT_ACCESS_TTL_SECONDS", 15 * 60),
    jwtRefreshTtlSeconds: readNumberEnv("JWT_REFRESH_TTL_SECONDS", 30 * 24 * 60 * 60),
    subscriptionTempTokenTtlSeconds: readNumberEnv(
      "SUBSCRIPTION_TEMP_TOKEN_TTL_SECONDS",
      24 * 60 * 60
    ),
    sourceSyncDefaultIntervalMinutes: readNumberEnv("SOURCE_SYNC_INTERVAL_MINUTES", 360),
    rulesetCheckIntervalMinutes: readNumberEnv("RULESET_CHECK_INTERVAL_MINUTES", 24 * 60)
  };
};

export const ensureRuntimeDirectories = (config = getRuntimeConfig()) => {
  mkdirSync(dirname(config.databasePath), {
    recursive: true
  });
};
