import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

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

const resolveBinary = (options: MihomoGateOptions): string | null => {
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
    cachedBinary = { key, path: resolveBinary(options) };
  }
  return cachedBinary.path !== null;
};

export const validateWithMihomo = (
  yamlText: string,
  options: MihomoGateOptions
): MihomoValidation => {
  const key = `${options.mihomoPath ?? ""}|${options.dataDir}`;
  if (!cachedBinary || cachedBinary.key !== key) {
    cachedBinary = { key, path: resolveBinary(options) };
  }
  const binary = cachedBinary.path;
  if (!binary) {
    return { available: false, passed: null, exitCode: null, output: null, durationMs: null };
  }

  const workDir = resolve(tmpdir(), `pp-mihomo-${randomUUID()}`);
  mkdirSync(workDir, { recursive: true });

  try {
    // 预置离线 geodata，杜绝校验期下载（空目录会触发 mihomo 静默联网）
    for (const file of ["geosite.dat", "country.mmdb"]) {
      const source = resolve(options.assetsDir, "geodata", file);
      if (existsSync(source)) {
        copyFileSync(source, resolve(workDir, file));
      }
    }

    const configPath = resolve(workDir, "config.yaml");
    writeFileSync(configPath, yamlText);

    const startedAt = Date.now();
    const result = spawnSync(binary, ["-t", "-f", configPath, "-d", workDir], {
      encoding: "utf8",
      timeout: options.timeoutMs ?? 10_000
    });
    const durationMs = Date.now() - startedAt;

    const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    const tail = combined.split("\n").slice(-6).join("\n");

    return {
      available: true,
      passed: result.status === 0,
      exitCode: result.status,
      output: tail,
      durationMs
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
};
