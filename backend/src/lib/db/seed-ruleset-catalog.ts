import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Database } from "bun:sqlite";

// 内置规则源 seed：从仓库离线资产（assets/rulesets）落库 catalog + 内容快照。
// 离线内置原则（技术方案 §8）：首启无网络也必须可用；后台同步只做其后的更新。

const assetsRulesetsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../assets/rulesets"
);

export interface BuiltinRulesetManifestEntry {
  slug: string;
  name: string;
  description: string;
  behavior: "domain" | "ipcidr" | "classical";
  recommendedTarget: string;
  sourceUrl: string;
  file: string;
}

export const catalogIdForSlug = (slug: string) => `rsc_${slug.replaceAll("-", "_")}`;

export const sha256Hex = (input: string) =>
  createHash("sha256").update(input).digest("hex");

export const loadBuiltinRulesetManifest = (): BuiltinRulesetManifestEntry[] => {
  const manifestPath = resolve(assetsRulesetsDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    return [];
  }
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    entries: BuiltinRulesetManifestEntry[];
  };
  return parsed.entries;
};

export const loadBuiltinRulesetContent = (entry: BuiltinRulesetManifestEntry) => {
  const filePath = resolve(assetsRulesetsDir, entry.file);
  if (!existsSync(filePath)) {
    return null;
  }
  return readFileSync(filePath, "utf8");
};

const countPayloadEntries = (content: string) => {
  let count = 0;
  for (const line of content.split("\n")) {
    if (line.trimStart().startsWith("- ")) count += 1;
  }
  return count;
};

export const seedBuiltinRulesetCatalog = (db: Database): number => {
  const now = new Date().toISOString();
  const entries = loadBuiltinRulesetManifest();
  let seeded = 0;

  const insertCatalog = db.query(`
    INSERT INTO ruleset_catalog (
      id, owner_user_id, slug, name, description, source_type, source_url, source_repo,
      behavior, recommended_target, is_official, status, latest_snapshot_hash,
      update_available, created_at, updated_at
    ) VALUES (?, NULL, ?, ?, ?, 'http_file', ?, NULL, ?, ?, 1, 'active', NULL, 0, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      source_url = excluded.source_url,
      behavior = excluded.behavior,
      recommended_target = excluded.recommended_target,
      updated_at = excluded.updated_at
  `);
  const insertSnapshot = db.query(`
    INSERT OR IGNORE INTO ruleset_snapshots (hash, catalog_id, content, behavior, entry_count, is_public, fetched_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `);
  const setLatest = db.query(`
    UPDATE ruleset_catalog SET latest_snapshot_hash = ? WHERE id = ? AND latest_snapshot_hash IS NULL
  `);

  for (const entry of entries) {
    const content = loadBuiltinRulesetContent(entry);
    if (content === null) {
      continue;
    }
    const catalogId = catalogIdForSlug(entry.slug);
    insertCatalog.run(
      catalogId,
      entry.slug,
      entry.name,
      entry.description,
      entry.sourceUrl,
      entry.behavior,
      entry.recommendedTarget,
      now,
      now
    );
    const hash = sha256Hex(content);
    insertSnapshot.run(hash, catalogId, content, entry.behavior, countPayloadEntries(content), now);
    setLatest.run(hash, catalogId);
    seeded += 1;
  }

  return seeded;
};
