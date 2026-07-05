// 下载 mihomo 内核到 data/bin/（发布门禁用）：bun scripts/fetch-mihomo.ts
// Docker 构建期同样调用本脚本把二进制打进镜像。
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dataBinDir = resolve(import.meta.dir, "../data/bin");

const platformAsset = () => {
  const os = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  return `mihomo-${os}-${arch}`;
};

const main = async () => {
  const api = "https://api.github.com/repos/MetaCubeX/mihomo/releases/latest";
  const release = (await (await fetch(api)).json()) as {
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
  const gz = await (await fetch(asset.browser_download_url)).arrayBuffer();
  const binary = Bun.gunzipSync(new Uint8Array(gz));
  mkdirSync(dataBinDir, { recursive: true });
  const target = resolve(dataBinDir, "mihomo");
  writeFileSync(target, binary);
  chmodSync(target, 0o755);
  console.log(`ok → ${target}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
