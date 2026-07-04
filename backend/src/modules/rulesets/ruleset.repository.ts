import type { Database } from "bun:sqlite";

export interface RulesetCatalogEntry {
  id: string;
  ownerUserId: string | null;
  slug: string;
  name: string;
  description: string | null;
  sourceType: "git_repo" | "http_file" | "inline";
  sourceUrl: string | null;
  behavior: "domain" | "ipcidr" | "classical";
  recommendedTarget: string | null;
  isOfficial: boolean;
  status: "active" | "disabled" | "archived";
  latestSnapshotHash: string | null;
  updateAvailable: boolean;
  lastCheckedAt: string | null;
  lastCheckError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RulesetSnapshotRecord {
  hash: string;
  catalogId: string;
  content: string;
  behavior: "domain" | "ipcidr" | "classical";
  entryCount: number;
  isPublic: boolean;
  fetchedAt: string;
}

interface CatalogRow {
  id: string;
  owner_user_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  source_type: string;
  source_url: string | null;
  behavior: string;
  recommended_target: string | null;
  is_official: number;
  status: string;
  latest_snapshot_hash: string | null;
  update_available: number;
  last_checked_at: string | null;
  last_check_error: string | null;
  created_at: string;
  updated_at: string;
}

interface SnapshotRow {
  hash: string;
  catalog_id: string;
  content: string;
  behavior: string;
  entry_count: number;
  is_public: number;
  fetched_at: string;
}

const mapCatalog = (row: CatalogRow): RulesetCatalogEntry => ({
  id: row.id,
  ownerUserId: row.owner_user_id,
  slug: row.slug,
  name: row.name,
  description: row.description,
  sourceType: row.source_type as RulesetCatalogEntry["sourceType"],
  sourceUrl: row.source_url,
  behavior: row.behavior as RulesetCatalogEntry["behavior"],
  recommendedTarget: row.recommended_target,
  isOfficial: row.is_official === 1,
  status: row.status as RulesetCatalogEntry["status"],
  latestSnapshotHash: row.latest_snapshot_hash,
  updateAvailable: row.update_available === 1,
  lastCheckedAt: row.last_checked_at,
  lastCheckError: row.last_check_error,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const mapSnapshot = (row: SnapshotRow): RulesetSnapshotRecord => ({
  hash: row.hash,
  catalogId: row.catalog_id,
  content: row.content,
  behavior: row.behavior as RulesetSnapshotRecord["behavior"],
  entryCount: row.entry_count,
  isPublic: row.is_public === 1,
  fetchedAt: row.fetched_at
});

export class RulesetRepository {
  constructor(private readonly db: Database) {}

  listVisible(userId: string): RulesetCatalogEntry[] {
    return this.db
      .query<CatalogRow>(
        `SELECT * FROM ruleset_catalog
         WHERE status = 'active' AND (owner_user_id IS NULL OR owner_user_id = ?)
         ORDER BY is_official DESC, slug ASC`
      )
      .all(userId)
      .map(mapCatalog);
  }

  findById(id: string): RulesetCatalogEntry | null {
    const row = this.db.query<CatalogRow>("SELECT * FROM ruleset_catalog WHERE id = ?").get(id);
    return row ? mapCatalog(row) : null;
  }

  createUserCatalog(input: {
    id: string;
    ownerUserId: string;
    slug: string;
    name: string;
    description: string | null;
    sourceUrl: string;
    behavior: RulesetCatalogEntry["behavior"];
    recommendedTarget: string | null;
  }): RulesetCatalogEntry {
    const now = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO ruleset_catalog (
           id, owner_user_id, slug, name, description, source_type, source_url, source_repo,
           behavior, recommended_target, is_official, status, latest_snapshot_hash,
           update_available, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'http_file', ?, NULL, ?, ?, 0, 'active', NULL, 0, ?, ?)`
      )
      .run(
        input.id,
        input.ownerUserId,
        input.slug,
        input.name,
        input.description,
        input.sourceUrl,
        input.behavior,
        input.recommendedTarget,
        now,
        now
      );
    return this.findById(input.id)!;
  }

  slugExists(slug: string): boolean {
    return (
      this.db.query("SELECT 1 FROM ruleset_catalog WHERE slug = ?").get(slug) !== null
    );
  }

  findSnapshot(hash: string): RulesetSnapshotRecord | null {
    const row = this.db
      .query<SnapshotRow>("SELECT * FROM ruleset_snapshots WHERE hash = ?")
      .get(hash);
    return row ? mapSnapshot(row) : null;
  }

  findPublicSnapshot(hash: string): RulesetSnapshotRecord | null {
    const snapshot = this.findSnapshot(hash);
    return snapshot && snapshot.isPublic ? snapshot : null;
  }

  insertSnapshot(snapshot: RulesetSnapshotRecord) {
    this.db
      .query(
        `INSERT OR IGNORE INTO ruleset_snapshots (hash, catalog_id, content, behavior, entry_count, is_public, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        snapshot.hash,
        snapshot.catalogId,
        snapshot.content,
        snapshot.behavior,
        snapshot.entryCount,
        snapshot.isPublic ? 1 : 0,
        snapshot.fetchedAt
      );
  }

  setLatestSnapshot(catalogId: string, hash: string, updateAvailable: boolean) {
    this.db
      .query(
        "UPDATE ruleset_catalog SET latest_snapshot_hash = ?, update_available = ?, updated_at = ? WHERE id = ?"
      )
      .run(hash, updateAvailable ? 1 : 0, new Date().toISOString(), catalogId);
  }

  clearUpdateBadge(catalogId: string) {
    this.db
      .query("UPDATE ruleset_catalog SET update_available = 0, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), catalogId);
  }

  markChecked(catalogId: string, error: string | null) {
    this.db
      .query(
        "UPDATE ruleset_catalog SET last_checked_at = ?, last_check_error = ? WHERE id = ?"
      )
      .run(new Date().toISOString(), error, catalogId);
  }

  listDueForCheck(intervalMinutes: number, limit: number): RulesetCatalogEntry[] {
    const cutoff = new Date(Date.now() - intervalMinutes * 60_000).toISOString();
    return this.db
      .query<CatalogRow>(
        `SELECT * FROM ruleset_catalog
         WHERE status = 'active' AND source_url IS NOT NULL
           AND (last_checked_at IS NULL OR last_checked_at < ?)
         ORDER BY last_checked_at ASC NULLS FIRST
         LIMIT ?`
      )
      .all(cutoff, limit)
      .map(mapCatalog);
  }
}
