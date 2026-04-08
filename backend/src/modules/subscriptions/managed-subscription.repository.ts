import type { Database } from "bun:sqlite";

import type {
  ManagedSubscriptionMode,
  ManagedSubscriptionDetail,
  ManagedSubscriptionSummary,
  RenderStatus,
  ShareMode,
  SubscriptionUsageInfo,
  SyncStatus,
  Visibility
} from "../../types";

interface ManagedSubscriptionRow {
  id: string;
  ownerUserId: string;
  upstreamSourceId: string;
  templateId: string;
  draftId: string | null;
  renderMode: ManagedSubscriptionMode;
  displayName: string;
  visibility: Visibility;
  shareMode: ShareMode;
  isEnabled: number;
  currentSnapshotId: string | null;
  lastSuccessfulSnapshotId: string | null;
  lastSyncStatus: SyncStatus;
  lastRenderStatus: RenderStatus;
  lastSyncAt: string | null;
  lastRenderAt: string | null;
  lastErrorMessage: string | null;
  latestHeadersJson: string | null;
  latestUsageJson: string | null;
  createdAt: string;
  updatedAt: string;
  templateName: string | null;
  sourceName: string | null;
}

interface SnapshotRow {
  id: string;
  managedSubscriptionId: string;
  renderedYaml: string;
  renderedJson: string | null;
  forwardedHeadersJson: string | null;
  validationStatus: "success" | "failed";
  validationError: string | null;
  createdAt: string;
}

export interface ManagedSnapshotRecord extends SnapshotRow {}

export interface CreateManagedSubscriptionInput {
  id: string;
  ownerUserId: string;
  upstreamSourceId: string;
  templateId: string;
  draftId?: string | null;
  renderMode?: ManagedSubscriptionMode;
  displayName: string;
  visibility: Visibility;
  shareMode: ShareMode;
  isEnabled?: boolean;
}

export interface UpdateManagedSubscriptionInput {
  displayName?: string;
  visibility?: Visibility;
  shareMode?: ShareMode;
  isEnabled?: boolean;
  templateId?: string;
  upstreamSourceId?: string;
  draftId?: string | null;
  renderMode?: ManagedSubscriptionMode;
}

export interface CreateManagedSnapshotInput {
  id: string;
  managedSubscriptionId: string;
  upstreamSourceSnapshotId: string | null;
  templateVersionId: string | null;
  renderedYaml: string;
  renderedJson: string;
  forwardedHeadersJson: string | null;
  validationStatus: "success" | "failed";
  validationError?: string | null;
  createdAt: string;
}

const MANAGED_SELECT = `
  SELECT
    managed_subscriptions.id AS id,
    managed_subscriptions.owner_user_id AS ownerUserId,
    managed_subscriptions.upstream_source_id AS upstreamSourceId,
    managed_subscriptions.template_id AS templateId,
    managed_subscriptions.draft_id AS draftId,
    managed_subscriptions.render_mode AS renderMode,
    managed_subscriptions.display_name AS displayName,
    managed_subscriptions.visibility AS visibility,
    managed_subscriptions.share_mode AS shareMode,
    managed_subscriptions.is_enabled AS isEnabled,
    managed_subscriptions.current_snapshot_id AS currentSnapshotId,
    managed_subscriptions.last_successful_snapshot_id AS lastSuccessfulSnapshotId,
    managed_subscriptions.last_sync_status AS lastSyncStatus,
    managed_subscriptions.last_render_status AS lastRenderStatus,
    managed_subscriptions.last_sync_at AS lastSyncAt,
    managed_subscriptions.last_render_at AS lastRenderAt,
    managed_subscriptions.last_error_message AS lastErrorMessage,
    managed_subscriptions.latest_headers_json AS latestHeadersJson,
    managed_subscriptions.latest_usage_json AS latestUsageJson,
    managed_subscriptions.created_at AS createdAt,
    managed_subscriptions.updated_at AS updatedAt,
    templates.display_name AS templateName,
    upstream_sources.display_name AS sourceName
  FROM managed_subscriptions
  LEFT JOIN templates
    ON templates.id = managed_subscriptions.template_id
  LEFT JOIN upstream_sources
    ON upstream_sources.id = managed_subscriptions.upstream_source_id
`;

const mapSummary = (row: ManagedSubscriptionRow | null): ManagedSubscriptionSummary | null => {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    upstreamSourceId: row.upstreamSourceId,
    templateId: row.templateId,
    draftId: row.draftId,
    renderMode: row.renderMode,
    displayName: row.displayName,
    visibility: row.visibility,
    shareMode: row.shareMode,
    isEnabled: row.isEnabled === 1,
    currentSnapshotId: row.currentSnapshotId,
    lastSuccessfulSnapshotId: row.lastSuccessfulSnapshotId,
    lastSyncStatus: row.lastSyncStatus,
    lastRenderStatus: row.lastRenderStatus,
    lastSyncAt: row.lastSyncAt,
    lastRenderAt: row.lastRenderAt,
    lastErrorMessage: row.lastErrorMessage,
    latestHeaders: row.latestHeadersJson
      ? (JSON.parse(row.latestHeadersJson) as Record<string, string>)
      : {},
    latestUsage: row.latestUsageJson
      ? (JSON.parse(row.latestUsageJson) as SubscriptionUsageInfo)
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
};

export class ManagedSubscriptionRepository {
  constructor(private readonly db: Database) {}

  listByOwner(ownerUserId: string) {
    const query = this.db.query<ManagedSubscriptionRow>(
      `${MANAGED_SELECT} WHERE managed_subscriptions.owner_user_id = ? ORDER BY managed_subscriptions.updated_at DESC`
    );

    return query.all(ownerUserId).map((row) => mapSummary(row)!);
  }

  findByIdAndOwner(id: string, ownerUserId: string): ManagedSubscriptionDetail | null {
    const query = this.db.query<ManagedSubscriptionRow>(
      `${MANAGED_SELECT} WHERE managed_subscriptions.id = ? AND managed_subscriptions.owner_user_id = ? LIMIT 1`
    );
    const row = query.get(id, ownerUserId);
    const summary = mapSummary(row);

    if (!summary || !row) {
      return null;
    }

    const currentSnapshot = summary.currentSnapshotId
      ? this.findSnapshotById(summary.currentSnapshotId)
      : null;

    return {
      ...summary,
      renderedYaml: currentSnapshot?.renderedYaml ?? null,
      templateName: row.templateName,
      sourceName: row.sourceName
    };
  }

  findById(id: string): ManagedSubscriptionDetail | null {
    const query = this.db.query<ManagedSubscriptionRow>(
      `${MANAGED_SELECT} WHERE managed_subscriptions.id = ? LIMIT 1`
    );
    const row = query.get(id);
    const summary = mapSummary(row);

    if (!summary || !row) {
      return null;
    }

    const currentSnapshot = summary.currentSnapshotId
      ? this.findSnapshotById(summary.currentSnapshotId)
      : null;

    return {
      ...summary,
      renderedYaml: currentSnapshot?.renderedYaml ?? null,
      templateName: row.templateName,
      sourceName: row.sourceName
    };
  }

  findByDraftIdAndOwner(draftId: string, ownerUserId: string) {
    const query = this.db.query<ManagedSubscriptionRow>(
      `${MANAGED_SELECT} WHERE managed_subscriptions.draft_id = ? AND managed_subscriptions.owner_user_id = ? LIMIT 1`
    );
    const row = query.get(draftId, ownerUserId);
    const summary = mapSummary(row);

    if (!summary || !row) {
      return null;
    }

    const currentSnapshot = summary.currentSnapshotId
      ? this.findSnapshotById(summary.currentSnapshotId)
      : null;

    return {
      ...summary,
      renderedYaml: currentSnapshot?.renderedYaml ?? null,
      templateName: row.templateName,
      sourceName: row.sourceName
    };
  }

  create(input: CreateManagedSubscriptionInput) {
    const now = new Date().toISOString();
    const query = this.db.query(`
      INSERT INTO managed_subscriptions (
        id,
        owner_user_id,
        upstream_source_id,
        template_id,
        draft_id,
        render_mode,
        display_name,
        visibility,
        share_mode,
        is_enabled,
        last_sync_status,
        last_render_status,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', 'pending', ?, ?)
    `);

    query.run(
      input.id,
      input.ownerUserId,
      input.upstreamSourceId,
      input.templateId,
      input.draftId ?? null,
      input.renderMode ?? "template",
      input.displayName,
      input.visibility,
      input.shareMode,
      input.isEnabled === undefined ? 1 : input.isEnabled ? 1 : 0,
      now,
      now
    );

    return this.findByIdAndOwner(input.id, input.ownerUserId);
  }

  update(subscriptionId: string, ownerUserId: string, input: UpdateManagedSubscriptionInput) {
    const current = this.findByIdAndOwner(subscriptionId, ownerUserId);

    if (!current) {
      return null;
    }

    const query = this.db.query(`
      UPDATE managed_subscriptions
      SET
        display_name = ?,
        visibility = ?,
        share_mode = ?,
        is_enabled = ?,
        template_id = ?,
        upstream_source_id = ?,
        draft_id = ?,
        render_mode = ?,
        updated_at = ?
      WHERE id = ? AND owner_user_id = ?
    `);

    query.run(
      input.displayName ?? current.displayName,
      input.visibility ?? current.visibility,
      input.shareMode ?? current.shareMode,
      input.isEnabled === undefined ? (current.isEnabled ? 1 : 0) : input.isEnabled ? 1 : 0,
      input.templateId ?? current.templateId,
      input.upstreamSourceId ?? current.upstreamSourceId,
      input.draftId === undefined ? current.draftId : input.draftId,
      input.renderMode ?? current.renderMode,
      new Date().toISOString(),
      subscriptionId,
      ownerUserId
    );

    return this.findByIdAndOwner(subscriptionId, ownerUserId);
  }

  delete(subscriptionId: string, ownerUserId: string) {
    const query = this.db.query(`
      DELETE FROM managed_subscriptions
      WHERE id = ? AND owner_user_id = ?
    `);

    return query.run(subscriptionId, ownerUserId).changes > 0;
  }

  createSnapshot(input: CreateManagedSnapshotInput) {
    const query = this.db.query(`
      INSERT INTO managed_subscription_snapshots (
        id,
        managed_subscription_id,
        upstream_source_snapshot_id,
        template_version_id,
        rendered_yaml,
        rendered_json,
        forwarded_headers_json,
        validation_status,
        validation_error,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    query.run(
      input.id,
      input.managedSubscriptionId,
      input.upstreamSourceSnapshotId,
      input.templateVersionId,
      input.renderedYaml,
      input.renderedJson,
      input.forwardedHeadersJson,
      input.validationStatus,
      input.validationError ?? null,
      input.createdAt
    );
  }

  markRenderSuccess(input: {
    subscriptionId: string;
    snapshotId: string;
    syncedAt: string | null;
    renderedAt: string;
    latestHeadersJson: string | null;
    latestUsageJson: string | null;
  }) {
    const query = this.db.query(`
      UPDATE managed_subscriptions
      SET
        current_snapshot_id = ?,
        last_successful_snapshot_id = ?,
        last_sync_status = CASE WHEN ? IS NULL THEN last_sync_status ELSE 'success' END,
        last_render_status = 'success',
        last_sync_at = COALESCE(?, last_sync_at),
        last_render_at = ?,
        last_error_message = NULL,
        latest_headers_json = ?,
        latest_usage_json = ?,
        updated_at = ?
      WHERE id = ?
    `);
    const now = new Date().toISOString();

    query.run(
      input.snapshotId,
      input.snapshotId,
      input.syncedAt,
      input.syncedAt,
      input.renderedAt,
      input.latestHeadersJson,
      input.latestUsageJson,
      now,
      input.subscriptionId
    );
  }

  markRenderFailure(input: {
    subscriptionId: string;
    lastSyncStatus?: SyncStatus | null;
    syncedAt?: string | null;
    errorMessage: string;
  }) {
    const query = this.db.query(`
      UPDATE managed_subscriptions
      SET
        last_sync_status = COALESCE(?, last_sync_status),
        last_render_status = CASE
          WHEN last_successful_snapshot_id IS NOT NULL THEN 'degraded'
          ELSE 'failed'
        END,
        last_sync_at = COALESCE(?, last_sync_at),
        last_render_at = ?,
        last_error_message = ?,
        updated_at = ?
      WHERE id = ?
    `);
    const now = new Date().toISOString();

    query.run(
      input.lastSyncStatus ?? null,
      input.syncedAt ?? null,
      now,
      input.errorMessage,
      now,
      input.subscriptionId
    );
  }

  findSnapshotById(id: string) {
    const query = this.db.query<SnapshotRow>(`
      SELECT
        id,
        managed_subscription_id AS managedSubscriptionId,
        rendered_yaml AS renderedYaml,
        rendered_json AS renderedJson,
        forwarded_headers_json AS forwardedHeadersJson,
        validation_status AS validationStatus,
        validation_error AS validationError,
        created_at AS createdAt
      FROM managed_subscription_snapshots
      WHERE id = ?
      LIMIT 1
    `);

    return query.get(id) ?? null;
  }

  findLatestSuccessfulSnapshot(subscriptionId: string) {
    const query = this.db.query<SnapshotRow>(`
      SELECT
        id,
        managed_subscription_id AS managedSubscriptionId,
        rendered_yaml AS renderedYaml,
        rendered_json AS renderedJson,
        forwarded_headers_json AS forwardedHeadersJson,
        validation_status AS validationStatus,
        validation_error AS validationError,
        created_at AS createdAt
      FROM managed_subscription_snapshots
      WHERE managed_subscription_id = ? AND validation_status = 'success'
      ORDER BY created_at DESC
      LIMIT 1
    `);

    return query.get(subscriptionId) ?? null;
  }

  listSnapshots(subscriptionId: string) {
    const query = this.db.query<SnapshotRow>(`
      SELECT
        id,
        managed_subscription_id AS managedSubscriptionId,
        rendered_yaml AS renderedYaml,
        rendered_json AS renderedJson,
        forwarded_headers_json AS forwardedHeadersJson,
        validation_status AS validationStatus,
        validation_error AS validationError,
        created_at AS createdAt
      FROM managed_subscription_snapshots
      WHERE managed_subscription_id = ?
      ORDER BY created_at DESC
    `);

    return query.all(subscriptionId);
  }

  createPullLog(input: {
    id: string;
    managedSubscriptionId: string;
    tokenKind: "user_secret" | "temp_token";
    tempTokenId?: string | null;
    status: "success" | "failed" | "degraded" | "denied";
    httpStatus: number;
    syncAttempted: boolean;
    servedSnapshotId?: string | null;
    clientIp?: string | null;
    userAgent?: string | null;
    errorMessage?: string | null;
  }) {
    const query = this.db.query(`
      INSERT INTO managed_subscription_pull_logs (
        id,
        managed_subscription_id,
        token_kind,
        temp_token_id,
        status,
        http_status,
        sync_attempted,
        served_snapshot_id,
        client_ip,
        user_agent,
        error_message,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    query.run(
      input.id,
      input.managedSubscriptionId,
      input.tokenKind,
      input.tempTokenId ?? null,
      input.status,
      input.httpStatus,
      input.syncAttempted ? 1 : 0,
      input.servedSnapshotId ?? null,
      input.clientIp ?? null,
      input.userAgent ?? null,
      input.errorMessage ?? null,
      new Date().toISOString()
    );
  }
}
