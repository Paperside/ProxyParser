import type { Database } from "bun:sqlite";

import type {
  ShareMode,
  SubscriptionUsageInfo,
  SyncStatus,
  UpstreamSourceSummary,
  Visibility
} from "../../types";

interface SourceRow {
  id: string;
  ownerUserId: string;
  displayName: string;
  sourceUrl: string;
  visibility: Visibility;
  shareMode: ShareMode;
  isEnabled: number;
  lastSyncStatus: SyncStatus;
  lastSyncAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastFailedSyncAt: string | null;
  latestHeadersJson: string | null;
  latestUsageJson: string | null;
  lastSuccessfulSnapshotId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SnapshotRow {
  id: string;
  sourceId: string;
  rawContent: string;
  parsedJson: string | null;
  responseHeadersJson: string | null;
  usageJson: string | null;
  contentHash: string | null;
  etag: string | null;
  lastModifiedHeader: string | null;
  createdAt: string;
}

interface SyncLogRow {
  id: string;
  sourceId: string;
  status: SyncStatus;
  httpStatus: number | null;
  errorMessage: string | null;
  responseHeadersJson: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface UpstreamSourceRecord {
  id: string;
  ownerUserId: string;
  displayName: string;
  sourceUrl: string;
  visibility: Visibility;
  shareMode: ShareMode;
  isEnabled: boolean;
  lastSyncStatus: SyncStatus;
  lastSyncAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastFailedSyncAt: string | null;
  latestHeaders: Record<string, string>;
  latestUsage: SubscriptionUsageInfo | null;
  lastSuccessfulSnapshotId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpstreamSourceSnapshotRecord {
  id: string;
  sourceId: string;
  rawContent: string;
  parsedJson: string | null;
  responseHeadersJson: string | null;
  usageJson: string | null;
  contentHash: string | null;
  etag: string | null;
  lastModifiedHeader: string | null;
  createdAt: string;
}

export interface CreateUpstreamSourceInput {
  id: string;
  ownerUserId: string;
  displayName: string;
  sourceUrl: string;
  visibility: Visibility;
  shareMode: ShareMode;
}

export interface UpdateUpstreamSourceInput {
  displayName?: string;
  sourceUrl?: string;
  visibility?: Visibility;
  shareMode?: ShareMode;
  isEnabled?: boolean;
}

export interface CreateSyncLogInput {
  id: string;
  sourceId: string;
  status: Extract<SyncStatus, "syncing" | "success" | "failed" | "stale">;
  httpStatus?: number | null;
  errorMessage?: string | null;
  responseHeadersJson?: string | null;
  startedAt: string;
  finishedAt?: string | null;
}

export interface CreateSnapshotInput {
  id: string;
  sourceId: string;
  syncLogId?: string | null;
  rawContent: string;
  parsedJson?: string | null;
  responseHeadersJson?: string | null;
  usageJson?: string | null;
  contentHash?: string | null;
  etag?: string | null;
  lastModifiedHeader?: string | null;
  createdAt: string;
}

export interface UpdateSyncResultInput {
  sourceId: string;
  status: Extract<SyncStatus, "success" | "failed" | "stale">;
  syncedAt: string;
  latestHeadersJson?: string | null;
  latestUsageJson?: string | null;
  lastSuccessfulSnapshotId?: string | null;
}

const SOURCE_SELECT = `
  SELECT
    id,
    owner_user_id AS ownerUserId,
    display_name AS displayName,
    source_url AS sourceUrl,
    visibility,
    share_mode AS shareMode,
    is_enabled AS isEnabled,
    last_sync_status AS lastSyncStatus,
    last_sync_at AS lastSyncAt,
    last_successful_sync_at AS lastSuccessfulSyncAt,
    last_failed_sync_at AS lastFailedSyncAt,
    latest_headers_json AS latestHeadersJson,
    latest_usage_json AS latestUsageJson,
    last_successful_snapshot_id AS lastSuccessfulSnapshotId,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM upstream_sources
`;

const SNAPSHOT_SELECT = `
  SELECT
    id,
    source_id AS sourceId,
    raw_content AS rawContent,
    parsed_json AS parsedJson,
    response_headers_json AS responseHeadersJson,
    usage_json AS usageJson,
    content_hash AS contentHash,
    etag,
    last_modified_header AS lastModifiedHeader,
    created_at AS createdAt
  FROM upstream_source_snapshots
`;

const mapSource = (row: SourceRow | null): UpstreamSourceRecord | null => {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    displayName: row.displayName,
    sourceUrl: row.sourceUrl,
    visibility: row.visibility,
    shareMode: row.shareMode,
    isEnabled: row.isEnabled === 1,
    lastSyncStatus: row.lastSyncStatus,
    lastSyncAt: row.lastSyncAt,
    lastSuccessfulSyncAt: row.lastSuccessfulSyncAt,
    lastFailedSyncAt: row.lastFailedSyncAt,
    latestHeaders: row.latestHeadersJson
      ? (JSON.parse(row.latestHeadersJson) as Record<string, string>)
      : {},
    latestUsage: row.latestUsageJson
      ? (JSON.parse(row.latestUsageJson) as SubscriptionUsageInfo)
      : null,
    lastSuccessfulSnapshotId: row.lastSuccessfulSnapshotId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
};

const mapSnapshot = (row: SnapshotRow | null): UpstreamSourceSnapshotRecord | null => {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    sourceId: row.sourceId,
    rawContent: row.rawContent,
    parsedJson: row.parsedJson,
    responseHeadersJson: row.responseHeadersJson,
    usageJson: row.usageJson,
    contentHash: row.contentHash,
    etag: row.etag,
    lastModifiedHeader: row.lastModifiedHeader,
    createdAt: row.createdAt
  };
};

export class UpstreamSourceRepository {
  constructor(private readonly db: Database) {}

  listByOwner(ownerUserId: string) {
    const query = this.db.query<SourceRow>(
      `${SOURCE_SELECT} WHERE owner_user_id = ? ORDER BY updated_at DESC, created_at DESC`
    );

    return query.all(ownerUserId).map((row) => mapSource(row)!);
  }

  findByIdAndOwner(id: string, ownerUserId: string) {
    const query = this.db.query<SourceRow>(
      `${SOURCE_SELECT} WHERE id = ? AND owner_user_id = ? LIMIT 1`
    );

    return mapSource(query.get(id, ownerUserId));
  }

  listAllEnabled() {
    const query = this.db.query<SourceRow>(
      `${SOURCE_SELECT} WHERE is_enabled = 1 ORDER BY updated_at DESC`
    );

    return query.all().map((row) => mapSource(row)!);
  }

  create(input: CreateUpstreamSourceInput) {
    const now = new Date().toISOString();
    const query = this.db.query(`
      INSERT INTO upstream_sources (
        id,
        owner_user_id,
        display_name,
        source_url,
        visibility,
        share_mode,
        is_enabled,
        last_sync_status,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 1, 'idle', ?, ?)
    `);

    query.run(
      input.id,
      input.ownerUserId,
      input.displayName,
      input.sourceUrl,
      input.visibility,
      input.shareMode,
      now,
      now
    );

    return this.findByIdAndOwner(input.id, input.ownerUserId);
  }

  update(sourceId: string, ownerUserId: string, input: UpdateUpstreamSourceInput) {
    const current = this.findByIdAndOwner(sourceId, ownerUserId);

    if (!current) {
      return null;
    }

    const query = this.db.query(`
      UPDATE upstream_sources
      SET
        display_name = ?,
        source_url = ?,
        visibility = ?,
        share_mode = ?,
        is_enabled = ?,
        updated_at = ?
      WHERE id = ? AND owner_user_id = ?
    `);

    query.run(
      input.displayName ?? current.displayName,
      input.sourceUrl ?? current.sourceUrl,
      input.visibility ?? current.visibility,
      input.shareMode ?? current.shareMode,
      input.isEnabled === undefined ? (current.isEnabled ? 1 : 0) : input.isEnabled ? 1 : 0,
      new Date().toISOString(),
      sourceId,
      ownerUserId
    );

    return this.findByIdAndOwner(sourceId, ownerUserId);
  }

  delete(sourceId: string, ownerUserId: string) {
    const query = this.db.query(`
      DELETE FROM upstream_sources
      WHERE id = ? AND owner_user_id = ?
    `);

    return query.run(sourceId, ownerUserId).changes > 0;
  }

  createSyncLog(input: CreateSyncLogInput) {
    const query = this.db.query(`
      INSERT INTO upstream_source_sync_logs (
        id,
        source_id,
        status,
        http_status,
        error_message,
        response_headers_json,
        started_at,
        finished_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    query.run(
      input.id,
      input.sourceId,
      input.status,
      input.httpStatus ?? null,
      input.errorMessage ?? null,
      input.responseHeadersJson ?? null,
      input.startedAt,
      input.finishedAt ?? null
    );
  }

  updateSyncLog(input: CreateSyncLogInput) {
    const query = this.db.query(`
      UPDATE upstream_source_sync_logs
      SET
        status = ?,
        http_status = ?,
        error_message = ?,
        response_headers_json = ?,
        finished_at = ?
      WHERE id = ?
    `);

    query.run(
      input.status,
      input.httpStatus ?? null,
      input.errorMessage ?? null,
      input.responseHeadersJson ?? null,
      input.finishedAt ?? null,
      input.id
    );
  }

  createSnapshot(input: CreateSnapshotInput) {
    const query = this.db.query(`
      INSERT INTO upstream_source_snapshots (
        id,
        source_id,
        sync_log_id,
        raw_content,
        parsed_json,
        response_headers_json,
        usage_json,
        content_hash,
        etag,
        last_modified_header,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    query.run(
      input.id,
      input.sourceId,
      input.syncLogId ?? null,
      input.rawContent,
      input.parsedJson ?? null,
      input.responseHeadersJson ?? null,
      input.usageJson ?? null,
      input.contentHash ?? null,
      input.etag ?? null,
      input.lastModifiedHeader ?? null,
      input.createdAt
    );
  }

  updateSyncResult(input: UpdateSyncResultInput) {
    const current = this.db.query<SourceRow>(
      `${SOURCE_SELECT} WHERE id = ? LIMIT 1`
    ).get(input.sourceId);
    const now = new Date().toISOString();

    if (!current) {
      return;
    }

    const query = this.db.query(`
      UPDATE upstream_sources
      SET
        last_sync_status = ?,
        last_sync_at = ?,
        last_successful_sync_at = ?,
        last_failed_sync_at = ?,
        last_successful_snapshot_id = ?,
        latest_headers_json = ?,
        latest_usage_json = ?,
        updated_at = ?
      WHERE id = ?
    `);

    query.run(
      input.status,
      input.syncedAt,
      input.status === "success" ? input.syncedAt : current.lastSuccessfulSyncAt,
      input.status === "failed" ? input.syncedAt : current.lastFailedSyncAt,
      input.lastSuccessfulSnapshotId ?? current.lastSuccessfulSnapshotId,
      input.latestHeadersJson ?? JSON.stringify(mapSource(current)?.latestHeaders ?? {}),
      input.latestUsageJson ?? (current.latestUsageJson ?? null),
      now,
      input.sourceId
    );
  }

  findLatestSnapshot(sourceId: string) {
    const query = this.db.query<SnapshotRow>(
      `${SNAPSHOT_SELECT} WHERE source_id = ? ORDER BY created_at DESC LIMIT 1`
    );

    return mapSnapshot(query.get(sourceId));
  }

  findSnapshotById(id: string) {
    const query = this.db.query<SnapshotRow>(`${SNAPSHOT_SELECT} WHERE id = ? LIMIT 1`);
    return mapSnapshot(query.get(id));
  }

  findSyncLogById(id: string) {
    const query = this.db.query<SyncLogRow>(`
      SELECT
        id,
        source_id AS sourceId,
        status,
        http_status AS httpStatus,
        error_message AS errorMessage,
        response_headers_json AS responseHeadersJson,
        started_at AS startedAt,
        finished_at AS finishedAt
      FROM upstream_source_sync_logs
      WHERE id = ?
      LIMIT 1
    `);

    return query.get(id) ?? null;
  }
}
