import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

// mihomo 内核发布门禁（技术方案 §11）。
// 二进制解析：env PROXYPARSER_MIHOMO_PATH → data/bin/mihomo → $PATH。
// geodata：恒用仓库离线副本（assets/geodata），避免校验期联网（§11.1，实验 A-6）。

export interface MihomoGateOptions {
  mihomoPath: string | null; // runtime config 提供的 env 值
  dataDir: string;
  assetsDir: string;
  timeoutMs?: number;
}

export interface MihomoValidation {
  available: boolean;
  passed: boolean | null; // null = 未执行（不可用）
  exitCode: number | null;
  output: string | null; // 末尾若干行，用于展示错误
  durationMs: number | null;
}

interface GeodataManifest {
  version: number;
  files: Array<{ name: string; sourceUrl: string; sha256: string; size: number }>;
}

const REQUIRED_GEODATA = ["geosite.dat", "country.mmdb", "ASN.mmdb"] as const;
const DOWNLOAD_ATTEMPT = /(?:can't find .*start download|start download)/i;
const MAX_OUTPUT_BYTES = 64 * 1024;

export class MihomoAssetError extends Error {}

const outputTail = (output: string) => output.trim().split("\n").slice(-8).join("\n");

const appendOutput = (current: string, chunk: string | Buffer) =>
  `${current}${chunk.toString()}`.slice(-MAX_OUTPUT_BYTES);

const loadVerifiedMihomoGeodata = (assetsDir: string) => {
  const manifestPath = resolve(assetsDir, "geodata", "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new MihomoAssetError("Mihomo 离线 geodata 清单缺失，已拒绝启动内核校验。");
  }
  let manifest: GeodataManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as GeodataManifest;
  } catch {
    throw new MihomoAssetError("Mihomo 离线 geodata 清单无法解析，已拒绝启动内核校验。");
  }
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) {
    throw new MihomoAssetError("Mihomo 离线 geodata 清单版本不受支持，已拒绝启动内核校验。");
  }

  const entries = new Map(manifest.files.map((entry) => [entry.name, entry]));
  const verified: Array<{ name: string; bytes: Buffer }> = [];
  for (const name of REQUIRED_GEODATA) {
    const entry = entries.get(name);
    if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.size)) {
      throw new MihomoAssetError(`Mihomo 离线 geodata 清单缺少有效的 ${name}。`);
    }
    const source = resolve(assetsDir, "geodata", name);
    if (!existsSync(source)) {
      throw new MihomoAssetError(`Mihomo 离线 geodata 缺少 ${name}，已阻止内核联网下载。`);
    }
    const bytes = readFileSync(source);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== entry.size || sha256 !== entry.sha256) {
      throw new MihomoAssetError(`Mihomo 离线 geodata ${name} 完整性校验失败。`);
    }
    verified.push({ name, bytes });
  }
  return verified;
};

export const verifyMihomoGeodata = (assetsDir: string) => {
  loadVerifiedMihomoGeodata(assetsDir);
};

export const copyVerifiedMihomoGeodata = (assetsDir: string, workDir: string) => {
  for (const { name, bytes } of loadVerifiedMihomoGeodata(assetsDir)) {
    writeFileSync(resolve(workDir, name), bytes, { mode: 0o600 });
  }
};

export const resolveMihomoBinary = (options: MihomoGateOptions): string | null => {
  if (options.mihomoPath && existsSync(options.mihomoPath)) {
    return options.mihomoPath;
  }
  const bundled = resolve(options.dataDir, "bin", "mihomo");
  if (existsSync(bundled)) {
    return bundled;
  }
  const which = spawnSync("which", ["mihomo"], { encoding: "utf8" });
  if (which.status === 0) {
    const found = which.stdout.trim();
    return found.length > 0 ? found : null;
  }
  return null;
};

let cachedBinary: { key: string; path: string | null } | null = null;

export const isMihomoAvailable = (options: MihomoGateOptions): boolean => {
  const key = `${options.mihomoPath ?? ""}|${options.dataDir}`;
  if (!cachedBinary || cachedBinary.key !== key) {
    cachedBinary = { key, path: resolveMihomoBinary(options) };
  }
  return cachedBinary.path !== null;
};

export const validateWithMihomo = (
  yamlText: string,
  options: MihomoGateOptions
): MihomoValidation => {
  const key = `${options.mihomoPath ?? ""}|${options.dataDir}`;
  if (!cachedBinary || cachedBinary.key !== key) {
    cachedBinary = { key, path: resolveMihomoBinary(options) };
  }
  const binary = cachedBinary.path;
  if (!binary) {
    return { available: false, passed: null, exitCode: null, output: null, durationMs: null };
  }

  const workDir = resolve(tmpdir(), `pp-mihomo-${randomUUID()}`);
  mkdirSync(workDir, { recursive: true, mode: 0o700 });

  try {
    const startedAt = Date.now();
    try {
      copyVerifiedMihomoGeodata(options.assetsDir, workDir);
    } catch (error) {
      return {
        available: true,
        passed: false,
        exitCode: null,
        output: error instanceof Error ? error.message : "Mihomo 离线 geodata 校验失败。",
        durationMs: Date.now() - startedAt
      };
    }

    const configPath = resolve(workDir, "config.yaml");
    writeFileSync(configPath, yamlText, { mode: 0o600 });

    const result = spawnSync(binary, ["-t", "-f", configPath, "-d", workDir], {
      encoding: "utf8",
      timeout: options.timeoutMs ?? 30_000,
      maxBuffer: 1024 * 1024
    });
    const durationMs = Date.now() - startedAt;

    const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    const attemptedDownload = DOWNLOAD_ATTEMPT.test(combined);
    const tail = outputTail(combined);

    return {
      available: true,
      passed: result.status === 0 && !attemptedDownload,
      exitCode: result.status,
      output: attemptedDownload
        ? outputTail(`检测到 Mihomo 尝试联网下载 geodata，离线发布门禁已拒绝继续。\n${tail}`)
        : tail,
      durationMs
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
};

export const validateWithMihomoAsync = async (
  yamlText: string,
  options: MihomoGateOptions
): Promise<MihomoValidation> => {
  const key = `${options.mihomoPath ?? ""}|${options.dataDir}`;
  if (!cachedBinary || cachedBinary.key !== key) {
    cachedBinary = { key, path: resolveMihomoBinary(options) };
  }
  const binary = cachedBinary.path;
  if (!binary) {
    return { available: false, passed: null, exitCode: null, output: null, durationMs: null };
  }

  const workDir = resolve(tmpdir(), `pp-mihomo-${randomUUID()}`);
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  const startedAt = Date.now();
  try {
    try {
      copyVerifiedMihomoGeodata(options.assetsDir, workDir);
    } catch (error) {
      return {
        available: true,
        passed: false,
        exitCode: null,
        output: error instanceof Error ? error.message : "Mihomo 离线 geodata 校验失败。",
        durationMs: Date.now() - startedAt
      };
    }
    const configPath = resolve(workDir, "config.yaml");
    writeFileSync(configPath, yamlText, { mode: 0o600 });

    return await new Promise<MihomoValidation>((resolveValidation) => {
      const child = spawn(binary, ["-t", "-f", configPath, "-d", workDir], {
        stdio: ["ignore", "pipe", "pipe"]
      });
      let output = "";
      let timedOut = false;
      let settled = false;
      const finish = (exitCode: number | null, spawnError?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const combined = spawnError ? appendOutput(output, spawnError.message) : output;
        const attemptedDownload = DOWNLOAD_ATTEMPT.test(combined);
        const durationMs = Date.now() - startedAt;
        let tail = outputTail(combined);
        if (attemptedDownload) {
          tail = outputTail(`检测到 Mihomo 尝试联网下载 geodata，离线发布门禁已拒绝继续。\n${tail}`);
        } else if (timedOut) {
          tail = outputTail(`Mihomo 内核校验超过 ${options.timeoutMs ?? 30_000}ms，已终止。\n${tail}`);
        }
        resolveValidation({
          available: true,
          passed: exitCode === 0 && !timedOut && !attemptedDownload && !spawnError,
          exitCode,
          output: tail || null,
          durationMs
        });
      };
      child.stdout?.on("data", (chunk) => { output = appendOutput(output, chunk); });
      child.stderr?.on("data", (chunk) => { output = appendOutput(output, chunk); });
      child.once("error", (error) => finish(null, error));
      child.once("close", (code) => finish(code));
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, options.timeoutMs ?? 30_000);
    });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
};
