// 下载 mihomo 内核到 data/bin/（发布门禁用）：bun scripts/fetch-mihomo.ts
// Docker 构建期同样调用本脚本把二进制打进镜像。
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dataBinDir = resolve(import.meta.dir, "../data/bin");

const platformAsset = () => {
  const os = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  return `mihomo-${os}-${arch}`;
};

const main = async () => {
  const api = "https://api.github.com/repos/MetaCubeX/mihomo/releases/latest";
  const releaseResponse = await fetch(api, { signal: AbortSignal.timeout(120_000) });
  if (!releaseResponse.ok) {
    throw new Error(`查询 Mihomo 最新版本失败：HTTP ${releaseResponse.status}`);
  }
  const release = (await releaseResponse.json()) as {
    assets: Array<{ name: string; browser_download_url: string }>;
  };
  const prefix = platformAsset();
  const asset = release.assets.find(
    (candidate) =>
      candidate.name.startsWith(`${prefix}-v`) && candidate.name.endsWith(".gz")
  );
  if (!asset) {
    throw new Error(`未找到平台资产 ${prefix}`);
  }
  console.log(`downloading ${asset.name} ...`);
  const binaryResponse = await fetch(asset.browser_download_url, {
    signal: AbortSignal.timeout(120_000)
  });
  if (!binaryResponse.ok) {
    throw new Error(`下载 ${asset.name} 失败：HTTP ${binaryResponse.status}`);
  }
  const gz = await binaryResponse.arrayBuffer();
  const binary = Bun.gunzipSync(new Uint8Array(gz));
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
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
  console.log(`ok → ${target}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
