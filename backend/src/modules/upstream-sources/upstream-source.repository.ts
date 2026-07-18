import type { Database } from "bun:sqlite";

import type { ClashProxyDocument, SubscriptionUsageInfo, SyncStatus } from "../../types";

export interface SourceRecord {
  id: string;
  ownerUserId: string;
  displayName: string;
  sourceUrl: string;
  sourceKind: "url" | "uploaded_yaml";
  uploadedFileName: string | null;
  isEnabled: boolean;
  syncIntervalMinutes: number;
  nextSyncAt: string | null;
  lastSyncStatus: SyncStatus;
  lastSyncAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastFailedSyncAt: string | null;
  lastErrorMessage: string | null;
  lastSuccessfulSnapshotId: string | null;
  headers: Record<string, string>;
  usage: SubscriptionUsageInfo | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceSnapshotRecord {
  id: string;
  sourceId: string;
  rawContent: string;
  parsed: ClashProxyDocument | null;
  headers: Record<string, string>;
  usage: SubscriptionUsageInfo | null;
  contentHash: string | null;
  etag: string | null;
  lastModifiedHeader: string | null;
  createdAt: string;
}

export interface ParsedSourceSnapshotRecord {
  id: string;
  parsed: ClashProxyDocument | null;
}

interface WorkspaceSnapshotRow {
  id: string;
  proxies_json: string | null;
  proxy_groups_json: string | null;
}

export interface SyncReportRecord {
  id: string;
  upstreamSourceId: string;
  fromSnapshotId: string | null;
  toSnapshotId: string;
  nodesAdded: Array<{ id: string; name: string }>;
  nodesRemoved: Array<{ id: string; name: string }>;
  nodesRenamed: Array<{ id: string; from: string; to: string }>;
  nodesUpdated: Array<{ id: string; name: string }>;
  createdAt: string;
}

interface SourceRow {
  id: string;
  owner_user_id: string;
  display_name: string;
  source_url: string;
  source_kind: string;
  uploaded_file_name: string | null;
  is_enabled: number;
  sync_interval_minutes: number;
  next_sync_at: string | null;
  last_sync_status: string;
  last_sync_at: string | null;
  last_successful_sync_at: string | null;
  last_failed_sync_at: string | null;
  last_error_message: string | null;
  last_successful_snapshot_id: string | null;
  latest_headers_json: string | null;
  latest_usage_json: string | null;
  created_at: string;
  updated_at: string;
}

interface SnapshotRow {
  id: string;
  source_id: string;
  raw_content: string;
  parsed_json: string | null;
  response_headers_json: string | null;
  usage_json: string | null;
  content_hash: string | null;
  etag: string | null;
  last_modified_header: string | null;
  created_at: string;
}

interface ReportRow {
  id: string;
  upstream_source_id: string;
  from_snapshot_id: string | null;
  to_snapshot_id: string;
  nodes_added: string;
  nodes_removed: string;
  nodes_renamed: string;
  nodes_updated: string;
  created_at: string;
}

const parseJson = <T,>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const mapSource = (row: SourceRow): SourceRecord => ({
  id: row.id,
  ownerUserId: row.owner_user_id,
  displayName: row.display_name,
  sourceUrl: row.source_url,
  sourceKind: row.source_kind as SourceRecord["sourceKind"],
  uploadedFileName: row.uploaded_file_name,
  isEnabled: row.is_enabled === 1,
  syncIntervalMinutes: row.sync_interval_minutes,
  nextSyncAt: row.next_sync_at,
  lastSyncStatus: row.last_sync_status as SyncStatus,
  lastSyncAt: row.last_sync_at,
  lastSuccessfulSyncAt: row.last_successful_sync_at,
  lastFailedSyncAt: row.last_failed_sync_at,
  lastErrorMessage: row.last_error_message,
  lastSuccessfulSnapshotId: row.last_successful_snapshot_id,
  headers: parseJson(row.latest_headers_json, {}),
  usage: parseJson(row.latest_usage_json, null),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const mapSnapshot = (row: SnapshotRow): SourceSnapshotRecord => ({
  id: row.id,
  sourceId: row.source_id,
  rawContent: row.raw_content,
  parsed: parseJson(row.parsed_json, null),
  headers: parseJson(row.response_headers_json, {}),
  usage: parseJson(row.usage_json, null),
  contentHash: row.content_hash,
  etag: row.etag,
  lastModifiedHeader: row.last_modified_header,
  createdAt: row.created_at
});

const mapReport = (row: ReportRow): SyncReportRecord => ({
  id: row.id,
  upstreamSourceId: row.upstream_source_id,
  fromSnapshotId: row.from_snapshot_id,
  toSnapshotId: row.to_snapshot_id,
  nodesAdded: parseJson(row.nodes_added, []),
  nodesRemoved: parseJson(row.nodes_removed, []),
  nodesRenamed: parseJson(row.nodes_renamed, []),
  nodesUpdated: parseJson(row.nodes_updated, []),
  createdAt: row.created_at
});

export class UpstreamSourceRepository {
  constructor(private readonly db: Database) {}

  create(input: {
    id: string;
    ownerUserId: string;
    displayName: string;
    sourceUrl: string;
    sourceKind: SourceRecord["sourceKind"];
    uploadedFileName: string | null;
    syncIntervalMinutes: number;
  }): SourceRecord {
    const now = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO upstream_sources (
           id, owner_user_id, display_name, source_url, source_kind, uploaded_file_name,
           is_enabled, sync_interval_minutes, next_sync_at, last_sync_status,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'idle', ?, ?)`
      )
      .run(
        input.id,
        input.ownerUserId,
        input.displayName,
        input.sourceUrl,
        input.sourceKind,
        input.uploadedFileName,
        input.syncIntervalMinutes,
        now,
        now,
        now
      );
    return this.findById(input.id)!;
  }

  update(
    id: string,
    patch: Partial<{
      displayName: string;
      sourceUrl: string;
      isEnabled: boolean;
      syncIntervalMinutes: number;
    }>
  ) {
    const current = this.findById(id);
    if (!current) return;
    this.db
      .query(
        `UPDATE upstream_sources SET display_name = ?, source_url = ?, is_enabled = ?, sync_interval_minutes = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        patch.displayName ?? current.displayName,
        patch.sourceUrl ?? current.sourceUrl,
        (patch.isEnabled ?? current.isEnabled) ? 1 : 0,
        patch.syncIntervalMinutes ?? current.syncIntervalMinutes,
        new Date().toISOString(),
        id
      );
  }

  updateUploadedMetadata(id: string, uploadedFileName: string | null) {
    const sourceUrl = `uploaded://${uploadedFileName ?? "config.yaml"}`;
    this.db
      .query(
        `UPDATE upstream_sources
         SET uploaded_file_name = ?, source_url = ?, updated_at = ?
         WHERE id = ? AND source_kind = 'uploaded_yaml'`
      )
      .run(uploadedFileName, sourceUrl, new Date().toISOString(), id);
  }

  delete(id: string) {
    this.db.query("DELETE FROM upstream_sources WHERE id = ?").run(id);
  }

  findById(id: string): SourceRecord | null {
    const row = this.db.query<SourceRow>("SELECT * FROM upstream_sources WHERE id = ?").get(id);
    return row ? mapSource(row) : null;
  }

  findByIdAndOwner(id: string, ownerUserId: string): SourceRecord | null {
    const source = this.findById(id);
    return source && source.ownerUserId === ownerUserId ? source : null;
  }

  listByOwner(ownerUserId: string): SourceRecord[] {
    return this.db
      .query<SourceRow>(
        "SELECT * FROM upstream_sources WHERE owner_user_id = ? ORDER BY created_at ASC"
      )
      .all(ownerUserId)
      .map(mapSource);
  }

  listDue(limit: number): SourceRecord[] {
    const now = new Date().toISOString();
    return this.db
      .query<SourceRow>(
        `SELECT * FROM upstream_sources
         WHERE is_enabled = 1 AND source_kind = 'url'
           AND last_sync_status != 'syncing'
           AND (next_sync_at IS NULL OR next_sync_at <= ?)
         ORDER BY COALESCE(next_sync_at, '') ASC
         LIMIT ?`
      )
      .all(now, limit)
      .map(mapSource);
  }

  // 乐观锁：仅当非 syncing 时置为 syncing，返回是否取得执行权
  tryBeginSync(id: string): boolean {
    const result = this.db
      .query(
        `UPDATE upstream_sources SET last_sync_status = 'syncing', last_sync_at = ?
         WHERE id = ? AND last_sync_status != 'syncing'`
      )
      .run(new Date().toISOString(), id);
    return result.changes > 0;
  }

  finishSyncSuccess(input: {
    id: string;
    snapshotId: string;
    headers: Record<string, string>;
    usage: SubscriptionUsageInfo | null;
    nextSyncAt: string;
  }) {
    const now = new Date().toISOString();
    this.db
      .query(
        `UPDATE upstream_sources SET
           last_sync_status = 'success', last_successful_sync_at = ?, last_error_message = NULL,
           last_successful_snapshot_id = ?, latest_headers_json = ?, latest_usage_json = ?,
           next_sync_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        now,
        input.snapshotId,
        JSON.stringify(input.headers),
        input.usage ? JSON.stringify(input.usage) : null,
        input.nextSyncAt,
        now,
        input.id
      );
  }

  finishSyncNotModified(id: string, nextSyncAt: string) {
    const now = new Date().toISOString();
    this.db
      .query(
        `UPDATE upstream_sources SET last_sync_status = 'success', last_successful_sync_at = ?, last_error_message = NULL, next_sync_at = ?, updated_at = ? WHERE id = ?`
      )
      .run(now, nextSyncAt, now, id);
  }

  finishSyncFailure(id: string, errorMessage: string, nextSyncAt: string) {
    const now = new Date().toISOString();
    this.db
      .query(
        `UPDATE upstream_sources SET last_sync_status = 'failed', last_failed_sync_at = ?, last_error_message = ?, next_sync_at = ?, updated_at = ? WHERE id = ?`
      )
      .run(now, errorMessage, nextSyncAt, now, id);
  }

  createSnapshot(input: {
    id: string;
    sourceId: string;
    rawContent: string;
    parsedJson: string | null;
    headers: Record<string, string>;
    usage: SubscriptionUsageInfo | null;
    contentHash: string | null;
    etag: string | null;
    lastModifiedHeader: string | null;
  }) {
    this.db
      .query(
        `INSERT INTO upstream_source_snapshots (
           id, source_id, sync_log_id, raw_content, parsed_json, response_headers_json,
           usage_json, content_hash, etag, last_modified_header, created_at
         ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.sourceId,
        input.rawContent,
        input.parsedJson,
        JSON.stringify(input.headers),
        input.usage ? JSON.stringify(input.usage) : null,
        input.contentHash,
        input.etag,
        input.lastModifiedHeader,
        new Date().toISOString()
      );
  }

  findSnapshotById(id: string): SourceSnapshotRecord | null {
    const row = this.db
      .query<SnapshotRow>("SELECT * FROM upstream_source_snapshots WHERE id = ?")
      .get(id);
    return row ? mapSnapshot(row) : null;
  }

  findParsedSnapshotById(id: string): ParsedSourceSnapshotRecord | null {
    const row = this.db
      .query<{ id: string; parsed_json: string | null }>(
        "SELECT id, parsed_json FROM upstream_source_snapshots WHERE id = ?"
      )
      .get(id);
    return row ? { id: row.id, parsed: parseJson<ClashProxyDocument | null>(row.parsed_json, null) } : null;
  }

  // 工作区、节点测速和 rebuild 渲染只需要节点与策略组。用 SQLite JSON
  // 投影避免把可能很大的上游 rules 正文读进 JS 堆并再次 JSON.parse。
  findWorkspaceSnapshotById(id: string): ParsedSourceSnapshotRecord | null {
    const row = this.db
      .query<WorkspaceSnapshotRow>(
        `SELECT id,
                json_extract(parsed_json, '$.proxies') AS proxies_json,
                json_extract(parsed_json, '$."proxy-groups"') AS proxy_groups_json
           FROM upstream_source_snapshots
          WHERE id = ?`
      )
      .get(id);
    if (!row) return null;
    return {
      id: row.id,
      parsed: {
        proxies: parseJson<ClashProxyDocument["proxies"]>(row.proxies_json, []),
        "proxy-groups": parseJson<ClashProxyDocument["proxy-groups"]>(
          row.proxy_groups_json,
          []
        )
      }
    };
  }

  findLatestSuccessfulSnapshot(sourceId: string): SourceSnapshotRecord | null {
    const source = this.findById(sourceId);
    if (!source?.lastSuccessfulSnapshotId) return null;
    return this.findSnapshotById(source.lastSuccessfulSnapshotId);
  }

  createSyncReport(input: {
    id: string;
    upstreamSourceId: string;
    fromSnapshotId: string | null;
    toSnapshotId: string;
    nodesAdded: SyncReportRecord["nodesAdded"];
    nodesRemoved: SyncReportRecord["nodesRemoved"];
    nodesRenamed: SyncReportRecord["nodesRenamed"];
    nodesUpdated: SyncReportRecord["nodesUpdated"];
  }) {
    this.db
      .query(
        `INSERT INTO source_sync_reports (
           id, upstream_source_id, from_snapshot_id, to_snapshot_id,
           nodes_added, nodes_removed, nodes_renamed, nodes_updated, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.upstreamSourceId,
        input.fromSnapshotId,
        input.toSnapshotId,
        JSON.stringify(input.nodesAdded),
        JSON.stringify(input.nodesRemoved),
        JSON.stringify(input.nodesRenamed),
        JSON.stringify(input.nodesUpdated),
        new Date().toISOString()
      );
  }

  listSyncReports(sourceId: string, limit = 20): SyncReportRecord[] {
    return this.db
      .query<ReportRow>(
        `SELECT * FROM source_sync_reports WHERE upstream_source_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(sourceId, limit)
      .map(mapReport);
  }
}
