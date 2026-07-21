// 下载固定版本的 mihomo 内核到 data/bin/（发布门禁用）：bun scripts/fetch-mihomo.ts
// Docker 构建期同样调用本脚本把二进制打进镜像。
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dataBinDir = resolve(import.meta.dir, "../data/bin");

export const MIHOMO_RELEASE = "v1.19.28";

export type MihomoPlatform = "darwin" | "linux";
export type MihomoArchitecture = "amd64" | "arm64";

export interface MihomoAsset {
  name: string;
  sha256: string;
  size: number;
}

// 校验值来自该固定版本的官方 GitHub Release API asset.digest 字段。
// 固定资产名和压缩包 SHA-256，避免构建过程跟随 latest 漂移或接受被替换的资产。
export const MIHOMO_ASSETS = {
  "darwin-amd64": {
    // 上游不带级别后缀的 amd64 资产从 v1.19.28 起按 GOAMD64=v3 构建。
    // 固定 v1 资产，保证可在普通 x86-64 主机及 arm64 上的 amd64 构建模拟器中执行。
    name: "mihomo-darwin-amd64-v1-v1.19.28.gz",
    sha256: "dc49247406556ee78e9977b3e393d96389d64531ec02738fb848cbea6c8c21ad",
    size: 17_403_769
  },
  "darwin-arm64": {
    name: "mihomo-darwin-arm64-v1.19.28.gz",
    sha256: "40cdae2fab4b18df15f40eaa9dc3af70ab3d8be7f77164ae1e5f1af3a2a4fb44",
    size: 15_963_072
  },
  "linux-amd64": {
    name: "mihomo-linux-amd64-v1-v1.19.28.gz",
    sha256: "c0c446f0b0e0bceffffa32daad220ffd35915b9f576f35557f49226f09f54a72",
    size: 18_134_843
  },
  "linux-arm64": {
    name: "mihomo-linux-arm64-v1.19.28.gz",
    sha256: "2474450cd1c41dfa53036a54a4e85579f493d3af524d86c3d4b8e2b240b56cd2",
    size: 16_272_054
  }
} as const satisfies Record<`${MihomoPlatform}-${MihomoArchitecture}`, MihomoAsset>;

const releaseDownloadBase =
  `https://github.com/MetaCubeX/mihomo/releases/download/${MIHOMO_RELEASE}`;

export const getMihomoAsset = (
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture
): MihomoAsset & { url: string } => {
  if (platform !== "darwin" && platform !== "linux") {
    throw new Error(`不支持的平台：${platform}（仅支持 darwin/linux）`);
  }
  const arch = architecture === "x64" ? "amd64" : architecture;
  if (arch !== "amd64" && arch !== "arm64") {
    throw new Error(`不支持的架构：${architecture}（仅支持 x64/arm64）`);
  }
  const asset = MIHOMO_ASSETS[`${platform}-${arch}`];
  return { ...asset, url: `${releaseDownloadBase}/${asset.name}` };
};

export const verifyMihomoAsset = (asset: MihomoAsset, bytes: Uint8Array) => {
  if (bytes.byteLength !== asset.size) {
    throw new Error(
      `${asset.name} 大小校验失败：期望 ${asset.size} bytes，实际 ${bytes.byteLength} bytes`
    );
  }
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== asset.sha256) {
    throw new Error(
      `${asset.name} SHA-256 校验失败：期望 ${asset.sha256}，实际 ${actualSha256}`
    );
  }
};

export const main = async () => {
  const asset = getMihomoAsset(process.platform, process.arch);
  console.log(`downloading ${asset.name} (${MIHOMO_RELEASE}) ...`);
  const binaryResponse = await fetch(asset.url, {
    signal: AbortSignal.timeout(120_000)
  });
  if (!binaryResponse.ok) {
    throw new Error(`下载 ${asset.name} 失败：HTTP ${binaryResponse.status}`);
  }
  const gz = new Uint8Array(await binaryResponse.arrayBuffer());
  verifyMihomoAsset(asset, gz);
  const binary = Bun.gunzipSync(gz);
  if (binary.byteLength === 0) throw new Error(`${asset.name} 解压后为空`);
  mkdirSync(dataBinDir, { recursive: true });
  const target = resolve(dataBinDir, "mihomo");
  const temporary = `${target}.tmp`;
  try {
    writeFileSync(temporary, binary, { mode: 0o755 });
    chmodSync(temporary, 0o755);
    const probe = Bun.spawnSync([temporary, "-v"], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000
    });
    if (probe.exitCode !== 0) {
      throw new Error(`下载的 Mihomo 无法执行：${probe.stderr.toString().trim()}`);
    }
    const versionOutput = `${probe.stdout.toString()}\n${probe.stderr.toString()}`;
    if (!versionOutput.includes(MIHOMO_RELEASE.slice(1))) {
      throw new Error(
        `下载的 Mihomo 版本与固定版本 ${MIHOMO_RELEASE} 不符：${versionOutput.trim()}`
      );
    }
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
  console.log(`verified ${asset.sha256}`);
  console.log(`ok → ${target}`);
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
