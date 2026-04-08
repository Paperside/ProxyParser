import type { Database } from "bun:sqlite";

import { OFFICIAL_SYSTEM_USER_ID } from "../../lib/db/seed-builtin-templates";

export interface RulesetCatalogMetadata {
  category?: string;
  sourceFamily?: string;
  kind?: "rule_provider" | "geosite" | "geoip";
  behavior?: "domain" | "ipcidr" | "classical" | null;
  format?: string;
  parser?: string;
  recommended?: boolean;
  updateIntervalSeconds?: number;
  upstreamBranch?: string | null;
  upstreamPath?: string | null;
  importedByUser?: boolean;
  [key: string]: unknown;
}

interface RulesetCatalogRow {
  id: string;
  ownerUserId: string | null;
  slug: string;
  name: string;
  description: string | null;
  sourceType: "git_repo" | "http_file" | "inline";
  sourceUrl: string | null;
  sourceRepo: string | null;
  visibility: "private" | "unlisted" | "public";
  isOfficial: number;
  status: "active" | "disabled" | "archived";
  metadataJson: string;
  createdAt: string;
  updatedAt: string;
}

interface RulesetCacheRow {
  id: string;
  contentText: string;
  contentHash: string | null;
  etag: string | null;
  lastModifiedHeader: string | null;
  fetchStatus: "success" | "failed";
  errorMessage: string | null;
  fetchedAt: string;
  expiresAt: string | null;
}

interface MarketplaceTemplateRow {
  id: string;
  displayName: string;
  slug: string | null;
  description: string | null;
  visibility: "private" | "unlisted" | "public";
  publishStatus: "draft" | "published" | "archived";
  ownerUserId: string;
  ownerDisplayName: string | null;
  isOfficial: number;
  sourceLabel: string | null;
  sourceUrl: string | null;
  updatedAt: string;
}

export interface RulesetCatalogEntry {
  id: string;
  ownerUserId: string | null;
  slug: string;
  name: string;
  description: string | null;
  sourceType: "git_repo" | "http_file" | "inline";
  sourceUrl: string | null;
  sourceRepo: string | null;
  visibility: "private" | "unlisted" | "public";
  isOfficial: boolean;
  status: "active" | "disabled" | "archived";
  metadata: RulesetCatalogMetadata;
  createdAt: string;
  updatedAt: string;
  latestFetchStatus: "success" | "failed" | null;
  latestFetchedAt: string | null;
  latestExpiresAt: string | null;
  hasCachedContent: boolean;
}

export interface RulesetCatalogDetail extends RulesetCatalogEntry {
  latestContentText: string | null;
  latestContentHash: string | null;
  latestErrorMessage: string | null;
  latestEtag: string | null;
  latestLastModifiedHeader: string | null;
}

const parseMetadata = (value: string) => {
  try {
    return JSON.parse(value) as RulesetCatalogMetadata;
  } catch {
    return {};
  }
};

const LATEST_CACHE_JOIN = `
  LEFT JOIN ruleset_cache_entries latest_cache
    ON latest_cache.id = (
      SELECT cache.id
      FROM ruleset_cache_entries cache
      WHERE cache.catalog_item_id = ruleset_catalog.id
      ORDER BY cache.fetched_at DESC
      LIMIT 1
    )
`;

const RULESET_SELECT = `
  SELECT
    ruleset_catalog.id,
    ruleset_catalog.owner_user_id AS ownerUserId,
    ruleset_catalog.slug,
    ruleset_catalog.name,
    ruleset_catalog.description,
    ruleset_catalog.source_type AS sourceType,
    ruleset_catalog.source_url AS sourceUrl,
    ruleset_catalog.source_repo AS sourceRepo,
    ruleset_catalog.visibility,
    ruleset_catalog.is_official AS isOfficial,
    ruleset_catalog.status,
    ruleset_catalog.metadata_json AS metadataJson,
    ruleset_catalog.created_at AS createdAt,
    ruleset_catalog.updated_at AS updatedAt,
    latest_cache.fetch_status AS latestFetchStatus,
    latest_cache.fetched_at AS latestFetchedAt,
    latest_cache.expires_at AS latestExpiresAt,
    latest_cache.content_text AS latestContentText,
    latest_cache.content_hash AS latestContentHash,
    latest_cache.etag AS latestEtag,
    latest_cache.last_modified_header AS latestLastModifiedHeader,
    latest_cache.error_message AS latestErrorMessage
  FROM ruleset_catalog
  ${LATEST_CACHE_JOIN}
`;

const mapRuleset = (
  row:
    | (RulesetCatalogRow &
        Partial<RulesetCacheRow> & {
          latestFetchStatus: "success" | "failed" | null;
          latestFetchedAt: string | null;
          latestExpiresAt: string | null;
          latestContentText: string | null;
          latestContentHash: string | null;
          latestEtag: string | null;
          latestLastModifiedHeader: string | null;
          latestErrorMessage: string | null;
        })
    | null
): RulesetCatalogDetail | null => {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    slug: row.slug,
    name: row.name,
    description: row.description,
    sourceType: row.sourceType,
    sourceUrl: row.sourceUrl,
    sourceRepo: row.sourceRepo,
    visibility: row.visibility,
    isOfficial: row.isOfficial === 1,
    status: row.status,
    metadata: parseMetadata(row.metadataJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    latestFetchStatus: row.latestFetchStatus,
    latestFetchedAt: row.latestFetchedAt,
    latestExpiresAt: row.latestExpiresAt,
    hasCachedContent: Boolean(row.latestContentText),
    latestContentText: row.latestContentText,
    latestContentHash: row.latestContentHash,
    latestErrorMessage: row.latestErrorMessage,
    latestEtag: row.latestEtag,
    latestLastModifiedHeader: row.latestLastModifiedHeader
  };
};

export class MarketplaceRepository {
  constructor(private readonly db: Database) {}

  listPublicRulesets(): RulesetCatalogEntry[] {
    const query = this.db.query<
      RulesetCatalogRow & {
        latestFetchStatus: "success" | "failed" | null;
        latestFetchedAt: string | null;
        latestExpiresAt: string | null;
        latestContentText: string | null;
        latestContentHash: string | null;
        latestEtag: string | null;
        latestLastModifiedHeader: string | null;
        latestErrorMessage: string | null;
      }
    >(
      `${RULESET_SELECT}
       WHERE ruleset_catalog.visibility = 'public'
         AND ruleset_catalog.status = 'active'
       ORDER BY ruleset_catalog.is_official DESC, ruleset_catalog.updated_at DESC, ruleset_catalog.name ASC`
    );

    return query.all().map((row) => mapRuleset(row)!);
  }

  listAccessibleRulesets(ownerUserId: string): RulesetCatalogEntry[] {
    const query = this.db.query<
      RulesetCatalogRow & {
        latestFetchStatus: "success" | "failed" | null;
        latestFetchedAt: string | null;
        latestExpiresAt: string | null;
        latestContentText: string | null;
        latestContentHash: string | null;
        latestEtag: string | null;
        latestLastModifiedHeader: string | null;
        latestErrorMessage: string | null;
      }
    >(
      `${RULESET_SELECT}
       WHERE ruleset_catalog.status = 'active'
         AND (ruleset_catalog.visibility = 'public' OR ruleset_catalog.owner_user_id = ?)
       ORDER BY
         CASE WHEN ruleset_catalog.owner_user_id = ? THEN 0 ELSE 1 END,
         ruleset_catalog.is_official DESC,
         ruleset_catalog.updated_at DESC,
         ruleset_catalog.name ASC`
    );

    return query.all(ownerUserId, ownerUserId).map((row) => mapRuleset(row)!);
  }

  getPublicRulesetBySlug(slug: string): RulesetCatalogDetail | null {
    const query = this.db.query<
      RulesetCatalogRow & {
        latestFetchStatus: "success" | "failed" | null;
        latestFetchedAt: string | null;
        latestExpiresAt: string | null;
        latestContentText: string | null;
        latestContentHash: string | null;
        latestEtag: string | null;
        latestLastModifiedHeader: string | null;
        latestErrorMessage: string | null;
      }
    >(
      `${RULESET_SELECT}
       WHERE ruleset_catalog.slug = ?
         AND ruleset_catalog.visibility = 'public'
         AND ruleset_catalog.status = 'active'
       LIMIT 1`
    );

    return mapRuleset(query.get(slug));
  }

  findRulesetByIdAndOwner(id: string, ownerUserId: string) {
    const query = this.db.query<
      RulesetCatalogRow & {
        latestFetchStatus: "success" | "failed" | null;
        latestFetchedAt: string | null;
        latestExpiresAt: string | null;
        latestContentText: string | null;
        latestContentHash: string | null;
        latestEtag: string | null;
        latestLastModifiedHeader: string | null;
        latestErrorMessage: string | null;
      }
    >(
      `${RULESET_SELECT}
       WHERE ruleset_catalog.id = ?
         AND ruleset_catalog.owner_user_id = ?
       LIMIT 1`
    );

    return mapRuleset(query.get(id, ownerUserId));
  }

  findRulesetById(id: string) {
    const query = this.db.query<
      RulesetCatalogRow & {
        latestFetchStatus: "success" | "failed" | null;
        latestFetchedAt: string | null;
        latestExpiresAt: string | null;
        latestContentText: string | null;
        latestContentHash: string | null;
        latestEtag: string | null;
        latestLastModifiedHeader: string | null;
        latestErrorMessage: string | null;
      }
    >(
      `${RULESET_SELECT}
       WHERE ruleset_catalog.id = ?
       LIMIT 1`
    );

    return mapRuleset(query.get(id));
  }

  createRuleset(input: {
    id: string;
    ownerUserId: string;
    slug: string;
    name: string;
    description: string | null;
    sourceType: "http_file" | "inline";
    sourceUrl: string | null;
    sourceRepo: string | null;
    visibility: "private" | "unlisted" | "public";
    metadataJson: string;
  }) {
    const now = new Date().toISOString();
    const query = this.db.query(`
      INSERT INTO ruleset_catalog (
        id,
        owner_user_id,
        slug,
        name,
        description,
        source_type,
        source_url,
        source_repo,
        visibility,
        is_official,
        status,
        metadata_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?)
    `);

    query.run(
      input.id,
      input.ownerUserId,
      input.slug,
      input.name,
      input.description,
      input.sourceType,
      input.sourceUrl,
      input.sourceRepo,
      input.visibility,
      input.metadataJson,
      now,
      now
    );

    return this.findRulesetByIdAndOwner(input.id, input.ownerUserId);
  }

  updateRuleset(
    rulesetId: string,
    ownerUserId: string,
    input: {
      slug?: string;
      name?: string;
      description?: string | null;
      sourceUrl?: string | null;
      sourceRepo?: string | null;
      visibility?: "private" | "unlisted" | "public";
      status?: "active" | "disabled" | "archived";
      metadataJson?: string;
    }
  ) {
    const current = this.findRulesetByIdAndOwner(rulesetId, ownerUserId);

    if (!current) {
      return null;
    }

    const query = this.db.query(`
      UPDATE ruleset_catalog
      SET
        slug = ?,
        name = ?,
        description = ?,
        source_url = ?,
        source_repo = ?,
        visibility = ?,
        status = ?,
        metadata_json = ?,
        updated_at = ?
      WHERE id = ? AND owner_user_id = ?
    `);
    const now = new Date().toISOString();

    query.run(
      input.slug ?? current.slug,
      input.name ?? current.name,
      input.description === undefined ? current.description : input.description,
      input.sourceUrl === undefined ? current.sourceUrl : input.sourceUrl,
      input.sourceRepo === undefined ? current.sourceRepo : input.sourceRepo,
      input.visibility ?? current.visibility,
      input.status ?? current.status,
      input.metadataJson ?? JSON.stringify(current.metadata),
      now,
      rulesetId,
      ownerUserId
    );

    return this.findRulesetByIdAndOwner(rulesetId, ownerUserId);
  }

  deleteRuleset(rulesetId: string, ownerUserId: string) {
    const query = this.db.query(`
      DELETE FROM ruleset_catalog
      WHERE id = ? AND owner_user_id = ? AND is_official = 0
    `);

    return query.run(rulesetId, ownerUserId).changes > 0;
  }

  listSyncableRulesets() {
    const query = this.db.query<
      RulesetCatalogRow & {
        latestFetchStatus: "success" | "failed" | null;
        latestFetchedAt: string | null;
        latestExpiresAt: string | null;
        latestContentText: string | null;
        latestContentHash: string | null;
        latestEtag: string | null;
        latestLastModifiedHeader: string | null;
        latestErrorMessage: string | null;
      }
    >(
      `${RULESET_SELECT}
       WHERE ruleset_catalog.status = 'active'
         AND ruleset_catalog.source_type = 'http_file'
       ORDER BY ruleset_catalog.is_official DESC, ruleset_catalog.slug ASC`
    );

    return query.all().map((row) => mapRuleset(row)!);
  }

  createRulesetCacheEntry(input: {
    id: string;
    catalogItemId: string;
    contentText: string;
    contentHash: string | null;
    etag: string | null;
    lastModifiedHeader: string | null;
    fetchStatus: "success" | "failed";
    errorMessage: string | null;
    fetchedAt: string;
    expiresAt: string | null;
  }) {
    const query = this.db.query(`
      INSERT INTO ruleset_cache_entries (
        id,
        catalog_item_id,
        content_text,
        content_hash,
        etag,
        last_modified_header,
        fetch_status,
        error_message,
        fetched_at,
        expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    query.run(
      input.id,
      input.catalogItemId,
      input.contentText,
      input.contentHash,
      input.etag,
      input.lastModifiedHeader,
      input.fetchStatus,
      input.errorMessage,
      input.fetchedAt,
      input.expiresAt
    );
  }

  touchRulesetCatalog(catalogItemId: string, updatedAt: string) {
    const query = this.db.query(`
      UPDATE ruleset_catalog
      SET updated_at = ?
      WHERE id = ?
    `);

    query.run(updatedAt, catalogItemId);
  }

  listPublicTemplates() {
    const query = this.db.query<MarketplaceTemplateRow>(`
      SELECT
        templates.id,
        templates.display_name AS displayName,
        templates.slug,
        templates.description,
        templates.visibility,
        templates.publish_status AS publishStatus,
        templates.owner_user_id AS ownerUserId,
        users.display_name AS ownerDisplayName,
        CASE WHEN templates.owner_user_id = ? THEN 1 ELSE users.is_admin END AS isOfficial,
        templates.source_label AS sourceLabel,
        templates.source_url AS sourceUrl,
        templates.updated_at AS updatedAt
      FROM templates
      LEFT JOIN users
        ON users.id = templates.owner_user_id
      WHERE templates.visibility = 'public'
        AND templates.publish_status = 'published'
        AND templates.is_internal = 0
      ORDER BY isOfficial DESC, templates.updated_at DESC
    `);

    return query.all(OFFICIAL_SYSTEM_USER_ID).map((row) => ({
      ...row,
      isOfficial: row.isOfficial === 1
    }));
  }
}
