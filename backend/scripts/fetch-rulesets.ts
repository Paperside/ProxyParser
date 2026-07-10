// 更新仓库内置规则源离线快照：bun scripts/fetch-rulesets.ts
// 读取 assets/rulesets/manifest.json，为每条目按 sources 抓取一个或多个远端文件，
// 合并、去重、转换为统一的 classical payload 后写回本地离线快照 yaml。
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { mergeMultiSourceClassical, type RulesetSource } from "../src/lib/rulesets/merge";

const assetsDir = resolve(import.meta.dir, "../assets/rulesets");

export interface ManifestEntry {
  slug: string;
  sources: RulesetSource[];
  extraRules?: string[];
  file: string;
}

export const selectManifestEntries = (
  entries: ManifestEntry[],
  requested: string[]
): ManifestEntry[] => {
  const requestedSlugs = new Set(requested);
  if (requestedSlugs.size === 0) return entries;

  const selected = entries.filter((entry) => requestedSlugs.has(entry.slug));
  if (selected.length !== requestedSlugs.size) {
    const known = new Set(entries.map((entry) => entry.slug));
    const unknown = [...requestedSlugs].filter((slug) => !known.has(slug));
    throw new Error(`未知内置规则集：${unknown.join(", ")}`);
  }
  return selected;
};

const main = async () => {
  const manifest = JSON.parse(readFileSync(resolve(assetsDir, "manifest.json"), "utf8")) as {
    entries: ManifestEntry[];
  };
  const entries = selectManifestEntries(manifest.entries, Bun.argv.slice(2));

  for (const entry of entries) {
    process.stdout.write(`fetch ${entry.slug} (${entry.sources.length} 源) ... `);
    try {
      const { content, entryCount } = await mergeMultiSourceClassical({
        sources: entry.sources,
        extraRules: entry.extraRules ?? []
      });
      writeFileSync(resolve(assetsDir, entry.file), content);
      console.log(`ok (${entryCount} 条)`);
    } catch (error) {
      console.log(`FAILED ${error instanceof Error ? error.message : String(error)}`);
    }
  }
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
