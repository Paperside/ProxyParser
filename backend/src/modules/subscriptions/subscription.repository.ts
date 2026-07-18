import type { Database } from "bun:sqlite";

import { createId } from "../../lib/ids";
import type { BuildConfig } from "../../lib/build-config/types";
import type { DiffSummary } from "../../lib/render-v2/release-diff";
import type { MihomoValidation } from "../../lib/validate/mihomo-gate";
import type { EvaluateIssue } from "../../lib/render-v2/evaluate";
import type { SubscriptionUsageInfo } from "../../types";

export type PublishPolicy = "auto" | "confirm";
export type Health = "ok" | "warn" | "error";
export type ReleaseTrigger = "manual" | "upstream_sync" | "ruleset_update" | "rollback";

export interface SubscriptionRecord {
  id: string;
  ownerUserId: string;
  displayName: string;
  isEnabled: boolean;
  buildConfig: BuildConfig | null;
  draftBuildConfig: BuildConfig | null;
  draftRevision: number;
  activeReleaseId: string | null;
  publishPolicy: PublishPolicy;
  pendingUpstreamChange: boolean;
  health: Health;
  healthReasons: string[];
  headers: Record<string, string>;
  usage: SubscriptionUsageInfo | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseRecord {
  id: string;
  subscriptionId: string;
  seq: number;
  buildConfig: BuildConfig;
  sourceSnapshotIds: Record<string, string>;
  renderedYaml: string;
  renderedHash: string;
  diffSummary: DiffSummary | Record<string, never>;
  trigger: ReleaseTrigger;
  triggerDetail: string | null;
  validation: { structuralErrors: number; mihomo: MihomoValidation | null };
  createdBy: string | null;
  createdAt: string;
}

export type ReleaseSummaryRecord = Omit<
  ReleaseRecord,
  "buildConfig" | "sourceSnapshotIds" | "renderedYaml"
>;

export interface ReleaseArtifactRecord {
  id: string;
  subscriptionId: string;
  seq: number;
  renderedYaml: string;
  renderedHash: string;
}

export interface TokenRecord {
  id: string;
  subscriptionId: string;
  label: string | null;
  rotatedFromId: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface TempTokenRecord extends TokenRecord {
  expiresAt: string;
  canReveal: boolean;
}

export interface TempTokenRevealRecord {
  tokenCiphertext: Uint8Array | null;
  revokedAt: string | null;
  expiresAt: string;
}

export interface IssueRecord {
  id: string;
  subscriptionId: string;
  kind: string;
  severity: "warn" | "error";
  refs: Record<string, unknown>;
  message: string;
  suggestion: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export class DraftRevisionConflictError extends Error {
  constructor() {
    super("subscription draft revision conflict");
  }
}

interface SubscriptionRow {
  id: string;
  owner_user_id: string;
  display_name: string;
  is_enabled: number;
  build_config: string | null;
  draft_build_config: string | null;
  draft_revision: number;
  active_release_id: string | null;
  publish_policy: string;
  pending_upstream_change: number;
  health: string;
  health_reasons: string;
  latest_headers_json: string | null;
  latest_usage_json: string | null;
  created_at: string;
  updated_at: string;
}

interface ReleaseRow {
  id: string;
  subscription_id: string;
  seq: number;
  build_config: string;
  source_snapshot_ids: string;
  rendered_yaml: string;
  rendered_hash: string;
  diff_summary: string;
  trigger: string;
  trigger_detail: string | null;
  validation: string;
  created_by: string | null;
  created_at: string;
}

type ReleaseSummaryRow = Omit<ReleaseRow, "build_config" | "source_snapshot_ids" | "rendered_yaml">;

interface ReleaseArtifactRow {
  id: string;
  subscription_id: string;
  seq: number;
  rendered_yaml: string;
  rendered_hash: string;
}

const parseJson = <T,>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const mapSubscription = (row: SubscriptionRow): SubscriptionRecord => ({
  id: row.id,
  ownerUserId: row.owner_user_id,
  displayName: row.display_name,
  isEnabled: row.is_enabled === 1,
  buildConfig: parseJson<BuildConfig | null>(row.build_config, null),
  draftBuildConfig: parseJson<BuildConfig | null>(row.draft_build_config, null),
  draftRevision: row.draft_revision,
  activeReleaseId: row.active_release_id,
  publishPolicy: row.publish_policy as PublishPolicy,
  pendingUpstreamChange: row.pending_upstream_change === 1,
  health: row.health as Health,
  healthReasons: parseJson(row.health_reasons, []),
  headers: parseJson(row.latest_headers_json, {}),
  usage: parseJson(row.latest_usage_json, null),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const mapRelease = (row: ReleaseRow): ReleaseRecord => ({
  id: row.id,
  subscriptionId: row.subscription_id,
  seq: row.seq,
  buildConfig: JSON.parse(row.build_config) as BuildConfig,
  sourceSnapshotIds: parseJson(row.source_snapshot_ids, {}),
  renderedYaml: row.rendered_yaml,
  renderedHash: row.rendered_hash,
  diffSummary: parseJson(row.diff_summary, {}),
  trigger: row.trigger as ReleaseTrigger,
  triggerDetail: row.trigger_detail,
  validation: parseJson(row.validation, { structuralErrors: 0, mihomo: null }),
  createdBy: row.created_by,
  createdAt: row.created_at
});

const mapReleaseSummary = (row: ReleaseSummaryRow): ReleaseSummaryRecord => ({
  id: row.id,
  subscriptionId: row.subscription_id,
  seq: row.seq,
  renderedHash: row.rendered_hash,
  diffSummary: parseJson(row.diff_summary, {}),
  trigger: row.trigger as ReleaseTrigger,
  triggerDetail: row.trigger_detail,
  validation: parseJson(row.validation, { structuralErrors: 0, mihomo: null }),
  createdBy: row.created_by,
  createdAt: row.created_at
});

const mapReleaseArtifact = (row: ReleaseArtifactRow): ReleaseArtifactRecord => ({
  id: row.id,
  subscriptionId: row.subscription_id,
  seq: row.seq,
  renderedYaml: row.rendered_yaml,
  renderedHash: row.rendered_hash
});

export class SubscriptionRepository {
  constructor(private readonly db: Database) {}

  // ── 订阅 ───────────────────────────────────────────────────

  create(input: {
    id: string;
    ownerUserId: string;
    displayName: string;
    draftBuildConfig: BuildConfig;
    publishPolicy: PublishPolicy;
  }): SubscriptionRecord {
    const now = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO subscriptions (
           id, owner_user_id, display_name, is_enabled, build_config, draft_build_config,
           active_release_id, publish_policy, pending_upstream_change, health, health_reasons,
           created_at, updated_at
         ) VALUES (?, ?, ?, 1, NULL, ?, NULL, ?, 0, 'error', '["尚未发布任何版本"]', ?, ?)`
      )
      .run(
        input.id,
        input.ownerUserId,
        input.displayName,
        JSON.stringify(input.draftBuildConfig),
        input.publishPolicy,
        now,
        now
      );
    this.syncSourceIndex(input.id, [input.draftBuildConfig]);
    return this.findById(input.id)!;
  }

  findById(id: string): SubscriptionRecord | null {
    const row = this.db.query<SubscriptionRow>("SELECT * FROM subscriptions WHERE id = ?").get(id);
    return row ? mapSubscription(row) : null;
  }

  findByIdAndOwner(id: string, ownerUserId: string): SubscriptionRecord | null {
    const record = this.findById(id);
    return record && record.ownerUserId === ownerUserId ? record : null;
  }

  listByOwner(ownerUserId: string): SubscriptionRecord[] {
    return this.db
      .query<SubscriptionRow>(
        "SELECT * FROM subscriptions WHERE owner_user_id = ? ORDER BY created_at ASC"
      )
      .all(ownerUserId)
      .map(mapSubscription);
  }

  listBySource(sourceId: string): SubscriptionRecord[] {
    return this.db
      .query<SubscriptionRow>(
        `SELECT s.* FROM subscriptions s
         JOIN subscription_sources ss ON ss.subscription_id = s.id
         WHERE ss.source_id = ?`
      )
      .all(sourceId)
      .map(mapSubscription);
  }

  updateMeta(
    id: string,
    patch: Partial<{ displayName: string; isEnabled: boolean; publishPolicy: PublishPolicy }>
  ) {
    const current = this.findById(id);
    if (!current) return;
    this.db
      .query(
        `UPDATE subscriptions SET display_name = ?, is_enabled = ?, publish_policy = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        patch.displayName ?? current.displayName,
        (patch.isEnabled ?? current.isEnabled) ? 1 : 0,
        patch.publishPolicy ?? current.publishPolicy,
        new Date().toISOString(),
        id
      );
  }

  saveDraft(id: string, draft: BuildConfig | null, expectedRevision?: number): boolean {
    const serializedDraft = draft ? JSON.stringify(draft) : null;
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = expectedRevision === undefined
        ? this.db
            .query(
              `UPDATE subscriptions
               SET draft_build_config = ?, draft_revision = draft_revision + 1, updated_at = ?
               WHERE id = ?`
            )
            .run(serializedDraft, now, id)
        : this.db
            .query(
              `UPDATE subscriptions
               SET draft_build_config = ?, draft_revision = draft_revision + 1, updated_at = ?
               WHERE id = ? AND draft_revision = ?`
            )
            .run(serializedDraft, now, id, expectedRevision);
      if (result.changes === 0) {
        this.db.exec("ROLLBACK");
        return false;
      }

      const updated = this.findById(id);
      this.syncSourceIndex(id, [
        updated?.buildConfig ?? null,
        updated?.draftBuildConfig ?? null
      ]);
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  setPendingUpstreamChange(id: string, pending: boolean) {
    this.db
      .query("UPDATE subscriptions SET pending_upstream_change = ?, updated_at = ? WHERE id = ?")
      .run(pending ? 1 : 0, new Date().toISOString(), id);
  }

  setHealth(id: string, health: Health, reasons: string[]) {
    this.db
      .query("UPDATE subscriptions SET health = ?, health_reasons = ?, updated_at = ? WHERE id = ?")
      .run(health, JSON.stringify(reasons), new Date().toISOString(), id);
  }

  setUsage(id: string, headers: Record<string, string>, usage: SubscriptionUsageInfo | null) {
    this.db
      .query(
        "UPDATE subscriptions SET latest_headers_json = ?, latest_usage_json = ?, updated_at = ? WHERE id = ?"
      )
      .run(JSON.stringify(headers), usage ? JSON.stringify(usage) : null, new Date().toISOString(), id);
  }

  delete(id: string) {
    this.db.query("DELETE FROM subscriptions WHERE id = ?").run(id);
  }

  // 已发布配置与草稿的 sources 并集 → subscription_sources 物化索引。
  // 两者都需跟踪：草稿不应让已发布配置丢失上游变化通知。
  syncSourceIndex(id: string, configs: Array<BuildConfig | null>) {
    this.db.query("DELETE FROM subscription_sources WHERE subscription_id = ?").run(id);
    const insert = this.db.query(
      "INSERT OR IGNORE INTO subscription_sources (subscription_id, source_id) VALUES (?, ?)"
    );
    for (const config of configs) {
      if (!config) continue;
      for (const source of config.sources) {
        insert.run(id, source.sourceId);
      }
    }
  }

  // ── 版本 ───────────────────────────────────────────────────

  createRelease(input: {
    subscriptionId: string;
    buildConfig: BuildConfig;
    sourceSnapshotIds: Record<string, string>;
    renderedYaml: string;
    renderedHash: string;
    diffSummary: DiffSummary | Record<string, never>;
    trigger: ReleaseTrigger;
    triggerDetail: string | null;
    validation: ReleaseRecord["validation"];
    createdBy: string | null;
    expectedDraftRevision: number;
  }): ReleaseRecord {
    const id = createId("rel");
    const now = new Date().toISOString();
    let seq = 0;
    const insertRelease = this.db.query(
      `INSERT INTO releases (
         id, subscription_id, seq, build_config, source_snapshot_ids, rendered_yaml,
         rendered_hash, diff_summary, trigger, trigger_detail, validation, created_by, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      seq =
        (this.db
          .query<{ max_seq: number | null }>(
            "SELECT MAX(seq) AS max_seq FROM releases WHERE subscription_id = ?"
          )
          .get(input.subscriptionId)?.max_seq ?? 0) + 1;
      insertRelease.run(
        id,
        input.subscriptionId,
        seq,
        JSON.stringify(input.buildConfig),
        JSON.stringify(input.sourceSnapshotIds),
        input.renderedYaml,
        input.renderedHash,
        JSON.stringify(input.diffSummary),
        input.trigger,
        input.triggerDetail,
        JSON.stringify(input.validation),
        input.createdBy,
        now
      );
      const activate = this.db
        .query(
          `UPDATE subscriptions SET build_config = ?, draft_build_config = NULL,
             draft_revision = draft_revision + 1, active_release_id = ?,
             pending_upstream_change = 0, updated_at = ?
           WHERE id = ? AND draft_revision = ?`
        )
        .run(
          JSON.stringify(input.buildConfig),
          id,
          now,
          input.subscriptionId,
          input.expectedDraftRevision
        );
      if (activate.changes === 0) {
        throw new DraftRevisionConflictError();
      }
      this.syncSourceIndex(input.subscriptionId, [input.buildConfig]);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    // YAML 可能达到数十 MB，刚 INSERT 后不要再 SELECT * 从 SQLite 读回一遍。
    // 调用方已经持有不可变发布产物的全部输入，可直接构造返回值。
    return {
      id,
      subscriptionId: input.subscriptionId,
      seq,
      buildConfig: input.buildConfig,
      sourceSnapshotIds: input.sourceSnapshotIds,
      renderedYaml: input.renderedYaml,
      renderedHash: input.renderedHash,
      diffSummary: input.diffSummary,
      trigger: input.trigger,
      triggerDetail: input.triggerDetail,
      validation: input.validation,
      createdBy: input.createdBy,
      createdAt: now
    };
  }

  findReleaseById(id: string): ReleaseRecord | null {
    const row = this.db.query<ReleaseRow>("SELECT * FROM releases WHERE id = ?").get(id);
    return row ? mapRelease(row) : null;
  }

  findReleaseSummaryById(id: string): ReleaseSummaryRecord | null {
    const row = this.db
      .query<ReleaseSummaryRow>(
        `SELECT id, subscription_id, seq, rendered_hash, diff_summary, trigger,
                trigger_detail, validation, created_by, created_at
         FROM releases WHERE id = ?`
      )
      .get(id);
    return row ? mapReleaseSummary(row) : null;
  }

  findReleaseArtifactById(id: string): ReleaseArtifactRecord | null {
    const row = this.db
      .query<ReleaseArtifactRow>(
        `SELECT id, subscription_id, seq, rendered_yaml, rendered_hash
         FROM releases WHERE id = ?`
      )
      .get(id);
    return row ? mapReleaseArtifact(row) : null;
  }

  listReleases(subscriptionId: string, limit = 50): ReleaseRecord[] {
    return this.db
      .query<ReleaseRow>(
        "SELECT * FROM releases WHERE subscription_id = ? ORDER BY seq DESC LIMIT ?"
      )
      .all(subscriptionId, limit)
      .map(mapRelease);
  }

  listReleaseSummaries(subscriptionId: string, limit = 50): ReleaseSummaryRecord[] {
    return this.db
      .query<ReleaseSummaryRow>(
        `SELECT id, subscription_id, seq, rendered_hash, diff_summary, trigger,
                trigger_detail, validation, created_by, created_at
         FROM releases WHERE subscription_id = ? ORDER BY seq DESC LIMIT ?`
      )
      .all(subscriptionId, limit)
      .map(mapReleaseSummary);
  }

  // ── Token ──────────────────────────────────────────────────

  createToken(input: {
    subscriptionId: string;
    tokenHash: string;
    tokenCiphertext: Buffer;
    label: string | null;
    rotatedFromId: string | null;
  }): TokenRecord {
    const id = createId("tok");
    const now = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO subscription_tokens (id, subscription_id, token_hash, token_ciphertext, label, rotated_from_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.subscriptionId, input.tokenHash, input.tokenCiphertext, input.label, input.rotatedFromId, now);
    return {
      id,
      subscriptionId: input.subscriptionId,
      label: input.label,
      rotatedFromId: input.rotatedFromId,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: now
    };
  }

  findTokenById(subscriptionId: string, tokenId: string): TokenRecord | null {
    const row = this.db
      .query<{
        id: string;
        subscription_id: string;
        label: string | null;
        rotated_from_id: string | null;
        revoked_at: string | null;
        last_used_at: string | null;
        created_at: string;
      }>(
        `SELECT id, subscription_id, label, rotated_from_id, revoked_at, last_used_at, created_at
         FROM subscription_tokens WHERE id = ? AND subscription_id = ?`
      )
      .get(tokenId, subscriptionId);
    if (!row) return null;
    return {
      id: row.id,
      subscriptionId: row.subscription_id,
      label: row.label,
      rotatedFromId: row.rotated_from_id,
      revokedAt: row.revoked_at,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at
    };
  }

  getTokenCiphertext(subscriptionId: string, tokenId: string): Uint8Array | null {
    const row = this.db
      .query<{ token_ciphertext: Uint8Array | null }>(
        "SELECT token_ciphertext FROM subscription_tokens WHERE id = ? AND subscription_id = ?"
      )
      .get(tokenId, subscriptionId);
    return row?.token_ciphertext ?? null;
  }

  renameToken(subscriptionId: string, tokenId: string, label: string | null) {
    this.db
      .query("UPDATE subscription_tokens SET label = ? WHERE id = ? AND subscription_id = ?")
      .run(label, tokenId, subscriptionId);
  }

  // 长期链接「删除」是真删除：撤销即从列表消失，不保留历史行（技术方案调整，短期分享链接不受影响）。
  deleteToken(subscriptionId: string, tokenId: string) {
    this.db
      .query("DELETE FROM subscription_tokens WHERE id = ? AND subscription_id = ?")
      .run(tokenId, subscriptionId);
  }

  listTokens(subscriptionId: string): TokenRecord[] {
    return this.db
      .query<{
        id: string;
        subscription_id: string;
        label: string | null;
        rotated_from_id: string | null;
        revoked_at: string | null;
        last_used_at: string | null;
        created_at: string;
      }>(
        `SELECT id, subscription_id, label, rotated_from_id, revoked_at, last_used_at, created_at
         FROM subscription_tokens WHERE subscription_id = ? ORDER BY created_at DESC`
      )
      .all(subscriptionId)
      .map((row) => ({
        id: row.id,
        subscriptionId: row.subscription_id,
        label: row.label,
        rotatedFromId: row.rotated_from_id,
        revokedAt: row.revoked_at,
        lastUsedAt: row.last_used_at,
        createdAt: row.created_at
      }));
  }

  findActiveTokenByHash(subscriptionId: string, tokenHash: string): TokenRecord | null {
    const row = this.db
      .query<{ id: string; label: string | null }>(
        `SELECT id, label FROM subscription_tokens
         WHERE subscription_id = ? AND token_hash = ? AND revoked_at IS NULL`
      )
      .get(subscriptionId, tokenHash);
    if (!row) return null;
    this.db
      .query("UPDATE subscription_tokens SET last_used_at = ? WHERE id = ?")
      .run(new Date().toISOString(), row.id);
    return {
      id: row.id,
      subscriptionId,
      label: row.label,
      rotatedFromId: null,
      revokedAt: null,
      lastUsedAt: new Date().toISOString(),
      createdAt: ""
    };
  }

  createTempToken(input: {
    subscriptionId: string;
    tokenHash: string;
    tokenCiphertext: Buffer;
    label: string | null;
    expiresAt: string;
  }): TempTokenRecord {
    const id = createId("tmp");
    const now = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO subscription_temp_tokens
           (id, subscription_id, token_hash, token_ciphertext, label, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.subscriptionId,
        input.tokenHash,
        input.tokenCiphertext,
        input.label,
        input.expiresAt,
        now
      );
    return {
      id,
      subscriptionId: input.subscriptionId,
      label: input.label,
      rotatedFromId: null,
      revokedAt: null,
      lastUsedAt: null,
      expiresAt: input.expiresAt,
      canReveal: true,
      createdAt: now
    };
  }

  listTempTokens(subscriptionId: string): TempTokenRecord[] {
    const now = Date.now();
    return this.db
      .query<{
        id: string;
        label: string | null;
        expires_at: string;
        revoked_at: string | null;
        last_used_at: string | null;
        created_at: string;
        has_ciphertext: number;
      }>(
        `SELECT id, label, expires_at, revoked_at, last_used_at, created_at,
                token_ciphertext IS NOT NULL AS has_ciphertext
         FROM subscription_temp_tokens WHERE subscription_id = ? ORDER BY created_at DESC`
      )
      .all(subscriptionId)
      .map((row) => ({
        id: row.id,
        subscriptionId,
        label: row.label,
        rotatedFromId: null,
        revokedAt: row.revoked_at,
        lastUsedAt: row.last_used_at,
        expiresAt: row.expires_at,
        canReveal:
          row.has_ciphertext === 1 &&
          row.revoked_at === null &&
          Number.isFinite(Date.parse(row.expires_at)) &&
          Date.parse(row.expires_at) > now,
        createdAt: row.created_at
      }));
  }

  findTempTokenForReveal(
    subscriptionId: string,
    tokenId: string
  ): TempTokenRevealRecord | null {
    const row = this.db
      .query<{
        token_ciphertext: Uint8Array | null;
        revoked_at: string | null;
        expires_at: string;
      }>(
        `SELECT token_ciphertext, revoked_at, expires_at
         FROM subscription_temp_tokens
         WHERE id = ? AND subscription_id = ?`
      )
      .get(tokenId, subscriptionId);
    if (!row) return null;
    return {
      tokenCiphertext: row.token_ciphertext,
      revokedAt: row.revoked_at,
      expiresAt: row.expires_at
    };
  }

  revokeTempToken(subscriptionId: string, tokenId: string) {
    this.db
      .query(
        `UPDATE subscription_temp_tokens SET revoked_at = ?
         WHERE id = ? AND subscription_id = ? AND revoked_at IS NULL`
      )
      .run(new Date().toISOString(), tokenId, subscriptionId);
  }

  findActiveTempTokenByHash(subscriptionId: string, tokenHash: string): { id: string } | null {
    const row = this.db
      .query<{ id: string }>(
        `SELECT id FROM subscription_temp_tokens
         WHERE subscription_id = ? AND token_hash = ? AND revoked_at IS NULL AND expires_at > ?`
      )
      .get(subscriptionId, tokenHash, new Date().toISOString());
    if (row) {
      this.db
        .query("UPDATE subscription_temp_tokens SET last_used_at = ? WHERE id = ?")
        .run(new Date().toISOString(), row.id);
    }
    return row;
  }

  // ── 问题 ───────────────────────────────────────────────────

  replaceIssues(subscriptionId: string, issues: EvaluateIssue[]) {
    const now = new Date().toISOString();
    const resolveAll = this.db.query(
      "UPDATE subscription_issues SET resolved_at = ? WHERE subscription_id = ? AND resolved_at IS NULL"
    );
    const insert = this.db.query(
      `INSERT INTO subscription_issues (id, subscription_id, kind, severity, refs, message, suggestion, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`
    );
    this.db.exec("BEGIN");
    try {
      resolveAll.run(now, subscriptionId);
      for (const issue of issues) {
        insert.run(
          createId("iss"),
          subscriptionId,
          issue.kind,
          issue.severity,
          JSON.stringify(issue.refs),
          issue.message,
          now
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listOpenIssues(subscriptionId: string): IssueRecord[] {
    return this.db
      .query<{
        id: string;
        subscription_id: string;
        kind: string;
        severity: string;
        refs: string;
        message: string;
        suggestion: string | null;
        created_at: string;
        resolved_at: string | null;
      }>(
        `SELECT * FROM subscription_issues
         WHERE subscription_id = ? AND resolved_at IS NULL ORDER BY severity DESC, created_at ASC`
      )
      .all(subscriptionId)
      .map((row) => ({
        id: row.id,
        subscriptionId: row.subscription_id,
        kind: row.kind,
        severity: row.severity as "warn" | "error",
        refs: parseJson(row.refs, {}),
        message: row.message,
        suggestion: row.suggestion,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at
      }));
  }

  countOpenIssues(subscriptionId: string): { warn: number; error: number } {
    const rows = this.db
      .query<{ severity: string; count: number }>(
        `SELECT severity, COUNT(*) AS count FROM subscription_issues
         WHERE subscription_id = ? AND resolved_at IS NULL GROUP BY severity`
      )
      .all(subscriptionId);
    const result = { warn: 0, error: 0 };
    for (const row of rows) {
      if (row.severity === "warn") result.warn = row.count;
      if (row.severity === "error") result.error = row.count;
    }
    return result;
  }

  // ── 拉取日志 ───────────────────────────────────────────────

  createPullLog(input: {
    subscriptionId: string;
    tokenKind: "token" | "temp_token";
    tokenId: string | null;
    status: "success" | "failed" | "denied";
    httpStatus: number;
    servedReleaseId: string | null;
    clientIp: string | null;
    userAgent: string | null;
    errorMessage: string | null;
  }) {
    this.db
      .query(
        `INSERT INTO subscription_pull_logs (
           id, subscription_id, token_kind, token_id, status, http_status,
           served_release_id, client_ip, user_agent, error_message, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        createId("pull"),
        input.subscriptionId,
        input.tokenKind,
        input.tokenId,
        input.status,
        input.httpStatus,
        input.servedReleaseId,
        input.clientIp,
        input.userAgent,
        input.errorMessage,
        new Date().toISOString()
      );
  }

  listPullLogs(subscriptionId: string, limit = 50) {
    return this.db
      .query<{
        id: string;
        token_kind: string;
        status: string;
        http_status: number;
        served_release_id: string | null;
        client_ip: string | null;
        user_agent: string | null;
        error_message: string | null;
        created_at: string;
      }>(
        `SELECT id, token_kind, status, http_status, served_release_id, client_ip, user_agent, error_message, created_at
         FROM subscription_pull_logs WHERE subscription_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(subscriptionId, limit);
  }

  lastPullAt(subscriptionId: string): string | null {
    return (
      this.db
        .query<{ created_at: string }>(
          `SELECT created_at FROM subscription_pull_logs
           WHERE subscription_id = ? AND status = 'success' ORDER BY created_at DESC LIMIT 1`
        )
        .get(subscriptionId)?.created_at ?? null
    );
  }
}
