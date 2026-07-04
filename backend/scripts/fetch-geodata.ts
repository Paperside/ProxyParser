// 更新仓库内置离线 geodata（mihomo 校验门禁用）：bun scripts/fetch-geodata.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const geodataDir = resolve(import.meta.dir, "../assets/geodata");

const FILES = [
  ["geosite.dat", "https://github.com/MetaCubeX/meta-rules-dat/releases/latest/download/geosite.dat"],
  ["country.mmdb", "https://github.com/MetaCubeX/meta-rules-dat/releases/latest/download/country.mmdb"]
] as const;

const main = async () => {
  mkdirSync(geodataDir, { recursive: true });
  for (const [name, url] of FILES) {
    process.stdout.write(`fetch ${name} ... `);
    const response = await fetch(url);
    if (!response.ok) {
      console.log(`FAILED ${response.status}`);
      continue;
    }
    writeFileSync(resolve(geodataDir, name), new Uint8Array(await response.arrayBuffer()));
    console.log("ok");
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
