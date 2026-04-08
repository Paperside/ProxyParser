import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface RuntimeConfig {
  port: number;
  databasePath: string;
  migrationsDir: string;
  defaultLocale: string;
  jwtSecret: string;
  jwtIssuer: string;
  jwtAccessTtlSeconds: number;
  jwtRefreshTtlSeconds: number;
  subscriptionTempTokenTtlSeconds: number;
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
    return resolve(backendRootDir, "data", "proxyparser.sqlite");
  }

  return isAbsolute(configuredPath)
    ? configuredPath
    : resolve(backendRootDir, configuredPath);
};

export const getRuntimeConfig = (): RuntimeConfig => {
  return {
    port: readNumberEnv("PORT", 3001),
    databasePath: resolveDatabasePath(),
    migrationsDir: resolve(backendRootDir, "migrations"),
    defaultLocale: process.env.DEFAULT_LOCALE ?? "zh-CN",
    jwtSecret: process.env.JWT_SECRET ?? "dev-insecure-change-me",
    jwtIssuer: process.env.JWT_ISSUER ?? "proxyparser",
    jwtAccessTtlSeconds: readNumberEnv("JWT_ACCESS_TTL_SECONDS", 15 * 60),
    jwtRefreshTtlSeconds: readNumberEnv("JWT_REFRESH_TTL_SECONDS", 30 * 24 * 60 * 60),
    subscriptionTempTokenTtlSeconds: readNumberEnv(
      "SUBSCRIPTION_TEMP_TOKEN_TTL_SECONDS",
      24 * 60 * 60
    )
  };
};

export const ensureRuntimeDirectories = (config = getRuntimeConfig()) => {
  mkdirSync(dirname(config.databasePath), {
    recursive: true
  });
};
