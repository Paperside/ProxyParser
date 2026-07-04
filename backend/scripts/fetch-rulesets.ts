// 更新仓库内置规则源离线快照：bun scripts/fetch-rulesets.ts
// 读取 assets/rulesets/manifest.json，逐条抓取并规范化为 payload YAML 写回。
import yaml from "js-yaml";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const assetsDir = resolve(import.meta.dir, "../assets/rulesets");

interface ManifestEntry {
  slug: string;
  behavior: "domain" | "ipcidr" | "classical";
  sourceUrl: string;
  file: string;
}

export const normalizePayload = (text: string): { content: string; entryCount: number } => {
  const parsed = yaml.load(text);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>).payload)
  ) {
    throw new Error("内容不是合法的 payload YAML");
  }
  const payload = ((parsed as Record<string, unknown>).payload as unknown[])
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0);
  return {
    content: yaml.dump({ payload }, { noRefs: true, lineWidth: -1, sortKeys: false }),
    entryCount: payload.length
  };
};

const main = async () => {
  const manifest = JSON.parse(readFileSync(resolve(assetsDir, "manifest.json"), "utf8")) as {
    entries: ManifestEntry[];
  };

  for (const entry of manifest.entries) {
    process.stdout.write(`fetch ${entry.slug} ... `);
    const response = await fetch(entry.sourceUrl);
    if (!response.ok) {
      console.log(`FAILED ${response.status}`);
      continue;
    }
    const { content, entryCount } = normalizePayload(await response.text());
    writeFileSync(resolve(assetsDir, entry.file), content);
    console.log(`ok (${entryCount} 条)`);
  }
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
