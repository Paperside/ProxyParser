import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Database } from "bun:sqlite";
import yaml from "js-yaml";

import { encodeMultiSourceSpec, type RulesetSource } from "../rulesets/merge";

// 内置规则源 seed：从仓库离线资产（assets/rulesets）落库 catalog + 内容快照。
// 离线内置原则（技术方案 §8）：首启无网络也必须可用；后台同步只做其后的更新。

const assetsRulesetsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../assets/rulesets"
);

export type BuiltinGroupKind = "proxy-first" | "direct-first" | "reject" | "direct-builtin";

export interface BuiltinRulesetManifestEntry {
  slug: string;
  name: string;
  description: string;
  behavior: "domain" | "ipcidr" | "classical";
  groupKind: BuiltinGroupKind;
  recommendedTarget: string;
  sources: RulesetSource[];
  extraRules?: string[];
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

const payloadEntries = (content: string) => {
  try {
    const parsed = yaml.load(content);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "payload" in parsed &&
      Array.isArray(parsed.payload)
    ) {
      return new Set(parsed.payload.filter((entry): entry is string => typeof entry === "string"));
    }
  } catch {
    // 损坏或悬空的旧快照按缺少 mandatory rules 处理，回退到仓库内离线副本。
  }
  return new Set<string>();
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
  const getCatalogState = db.query<{
    latest_snapshot_hash: string | null;
    owner_user_id: string | null;
    is_official: number;
  }>(`
    SELECT latest_snapshot_hash, owner_user_id, is_official
    FROM ruleset_catalog
    WHERE id = ?
  `);
  const getSnapshotContent = db.query<{ content: string }>(`
    SELECT content FROM ruleset_snapshots WHERE hash = ?
  `);
  const promoteBundledSnapshot = db.query(`
    UPDATE ruleset_catalog
    SET latest_snapshot_hash = ?, update_available = 1, updated_at = ?
    WHERE id = ?
      AND latest_snapshot_hash = ?
      AND is_official = 1
      AND owner_user_id IS NULL
  `);

  for (const entry of entries) {
    const content = loadBuiltinRulesetContent(entry);
    if (content === null) {
      continue;
    }
    const catalogId = catalogIdForSlug(entry.slug);
    const sourceUrl = encodeMultiSourceSpec({
      sources: entry.sources,
      extraRules: entry.extraRules ?? []
    });
    insertCatalog.run(
      catalogId,
      entry.slug,
      entry.name,
      entry.description,
      sourceUrl,
      entry.behavior,
      entry.recommendedTarget,
      now,
      now
    );
    const hash = sha256Hex(content);
    insertSnapshot.run(hash, catalogId, content, entry.behavior, countPayloadEntries(content), now);
    setLatest.run(hash, catalogId);

    // 已存在的 catalog 可能仍指向旧版本快照。只有当旧 latest 缺少当前 manifest
    // 明确要求的后处理规则时，才把随版本发布的离线快照提升为 latest 并点亮徽章。
    // 这样能补齐新增的 mandatory extraRules，同时不会把已经包含这些规则、但内容更新的
    // 远端快照降级回较旧的 bundled snapshot；订阅本身仍保持钉版本，等待用户确认应用。
    const catalogState = getCatalogState.get(catalogId);
    const latestHash = catalogState?.latest_snapshot_hash ?? null;
    const requiredRules = entry.extraRules ?? [];
    if (
      catalogState?.is_official === 1 &&
      catalogState.owner_user_id === null &&
      latestHash &&
      latestHash !== hash &&
      requiredRules.length > 0
    ) {
      const bundledEntries = payloadEntries(content);
      const bundledHasRequiredRules = requiredRules.every((rule) => bundledEntries.has(rule));
      if (bundledHasRequiredRules) {
        const latestContent = getSnapshotContent.get(latestHash)?.content ?? null;
        const latestEntries = latestContent ? payloadEntries(latestContent) : new Set<string>();
        const isMissingRequiredRule = requiredRules.some((rule) => !latestEntries.has(rule));
        if (isMissingRequiredRule) {
          // CAS 防止启动 seed 与后台 refresh 并发时覆盖刚写入的更新快照。
          promoteBundledSnapshot.run(hash, now, catalogId, latestHash);
        }
      }
    }
    seeded += 1;
  }

  return seeded;
};
