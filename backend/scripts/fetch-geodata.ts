// 更新仓库内置离线 geodata（mihomo 校验门禁用）：bun scripts/fetch-geodata.ts
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const geodataDir = resolve(import.meta.dir, "../assets/geodata");

const FILES = [
  ["geosite.dat", "https://github.com/MetaCubeX/meta-rules-dat/releases/latest/download/geosite.dat"],
  ["country.mmdb", "https://github.com/MetaCubeX/meta-rules-dat/releases/latest/download/country.mmdb"],
  ["ASN.mmdb", "https://github.com/MetaCubeX/meta-rules-dat/releases/latest/download/GeoLite2-ASN.mmdb"]
] as const;

const main = async () => {
  mkdirSync(geodataDir, { recursive: true });
  const downloads: Array<{ name: string; url: string; bytes: Uint8Array }> = [];
  for (const [name, url] of FILES) {
    process.stdout.write(`fetch ${name} ... `);
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) {
      throw new Error(`fetch ${name} failed with HTTP ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error(`fetch ${name} returned an empty file`);
    downloads.push({ name, url, bytes });
    console.log("ok");
  }

  const manifest = {
    version: 1,
    files: downloads.map(({ name, url, bytes }) => ({
      name,
      sourceUrl: url,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.byteLength
    }))
  };
  for (const { name, bytes } of downloads) {
    const target = resolve(geodataDir, name);
    const temporary = `${target}.tmp`;
    writeFileSync(temporary, bytes, { mode: 0o644 });
    renameSync(temporary, target);
  }
  const manifestTarget = resolve(geodataDir, "manifest.json");
  const manifestTemporary = `${manifestTarget}.tmp`;
  writeFileSync(manifestTemporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  renameSync(manifestTemporary, manifestTarget);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
