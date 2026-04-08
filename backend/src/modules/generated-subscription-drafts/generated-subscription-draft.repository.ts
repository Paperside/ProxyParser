import type { Database } from "bun:sqlite";

interface DraftRow {
  id: string;
  ownerUserId: string;
  upstreamSourceId: string | null;
  displayName: string;
  currentStep: "source" | "proxies" | "groups_rules" | "settings" | "preview";
  shareabilityStatus: "unknown" | "shareable" | "source_locked";
  selectedSourceSnapshotId: string | null;
  lastPreviewYaml: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DraftStepRow {
  id: string;
  draftId: string;
  stepKey: "source" | "proxies" | "groups_rules" | "settings";
  patchMode: "patch" | "full_override" | null;
  editorMode: "visual" | "raw";
  operationsJson: string;
  rawJson: string | null;
  summaryJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedSubscriptionDraftSummary {
  id: string;
  ownerUserId: string;
  upstreamSourceId: string | null;
  displayName: string;
  currentStep: "source" | "proxies" | "groups_rules" | "settings" | "preview";
  shareabilityStatus: "unknown" | "shareable" | "source_locked";
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedSubscriptionDraftDetail extends GeneratedSubscriptionDraftSummary {
  selectedSourceSnapshotId: string | null;
  lastPreviewYaml: string | null;
  steps: Array<{
    id: string;
    stepKey: "source" | "proxies" | "groups_rules" | "settings";
    patchMode: "patch" | "full_override" | null;
    editorMode: "visual" | "raw";
    operations: unknown;
    raw: unknown;
    summary: Record<string, unknown> | null;
    createdAt: string;
    updatedAt: string;
  }>;
}

const mapDraftSummary = (row: DraftRow): GeneratedSubscriptionDraftSummary => {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    upstreamSourceId: row.upstreamSourceId,
    displayName: row.displayName,
    currentStep: row.currentStep,
    shareabilityStatus: row.shareabilityStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
};

const parseJson = (value: string | null) => {
  if (!value) {
    return null;
  }

  return JSON.parse(value) as unknown;
};

export class GeneratedSubscriptionDraftRepository {
  constructor(private readonly db: Database) {}

  listByOwner(ownerUserId: string) {
    const query = this.db.query<DraftRow>(`
      SELECT
        id,
        owner_user_id AS ownerUserId,
        upstream_source_id AS upstreamSourceId,
        display_name AS displayName,
        current_step AS currentStep,
        shareability_status AS shareabilityStatus,
        selected_source_snapshot_id AS selectedSourceSnapshotId,
        last_preview_yaml AS lastPreviewYaml,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM generated_subscription_drafts
      WHERE owner_user_id = ?
      ORDER BY updated_at DESC, created_at DESC
    `);

    return query.all(ownerUserId).map(mapDraftSummary);
  }

  findByIdAndOwner(draftId: string, ownerUserId: string): GeneratedSubscriptionDraftDetail | null {
    const draftQuery = this.db.query<DraftRow>(`
      SELECT
        id,
        owner_user_id AS ownerUserId,
        upstream_source_id AS upstreamSourceId,
        display_name AS displayName,
        current_step AS currentStep,
        shareability_status AS shareabilityStatus,
        selected_source_snapshot_id AS selectedSourceSnapshotId,
        last_preview_yaml AS lastPreviewYaml,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM generated_subscription_drafts
      WHERE id = ? AND owner_user_id = ?
      LIMIT 1
    `);
    const stepQuery = this.db.query<DraftStepRow>(`
      SELECT
        id,
        draft_id AS draftId,
        step_key AS stepKey,
        patch_mode AS patchMode,
        editor_mode AS editorMode,
        operations_json AS operationsJson,
        raw_json AS rawJson,
        summary_json AS summaryJson,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM generated_subscription_draft_steps
      WHERE draft_id = ?
      ORDER BY created_at ASC
    `);

    const draft = draftQuery.get(draftId, ownerUserId);

    if (!draft) {
      return null;
    }

    return {
      ...mapDraftSummary(draft),
      selectedSourceSnapshotId: draft.selectedSourceSnapshotId,
      lastPreviewYaml: draft.lastPreviewYaml,
      steps: stepQuery.all(draftId).map((step) => ({
        id: step.id,
        stepKey: step.stepKey,
        patchMode: step.patchMode,
        editorMode: step.editorMode,
        operations: parseJson(step.operationsJson),
        raw: parseJson(step.rawJson),
        summary: (parseJson(step.summaryJson) as Record<string, unknown> | null) ?? null,
        createdAt: step.createdAt,
        updatedAt: step.updatedAt
      }))
    };
  }

  create(input: {
    id: string;
    ownerUserId: string;
    upstreamSourceId: string | null;
    displayName: string;
    currentStep: DraftRow["currentStep"];
    shareabilityStatus: DraftRow["shareabilityStatus"];
    selectedSourceSnapshotId: string | null;
    lastPreviewYaml: string | null;
  }) {
    const now = new Date().toISOString();
    const query = this.db.query(`
      INSERT INTO generated_subscription_drafts (
        id,
        owner_user_id,
        upstream_source_id,
        display_name,
        current_step,
        shareability_status,
        selected_source_snapshot_id,
        last_preview_yaml,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    query.run(
      input.id,
      input.ownerUserId,
      input.upstreamSourceId,
      input.displayName,
      input.currentStep,
      input.shareabilityStatus,
      input.selectedSourceSnapshotId,
      input.lastPreviewYaml,
      now,
      now
    );

    return this.findByIdAndOwner(input.id, input.ownerUserId);
  }

  update(
    draftId: string,
    ownerUserId: string,
    input: {
      upstreamSourceId?: string | null;
      displayName?: string;
      currentStep?: DraftRow["currentStep"];
      shareabilityStatus?: DraftRow["shareabilityStatus"];
      selectedSourceSnapshotId?: string | null;
      lastPreviewYaml?: string | null;
    }
  ) {
    const current = this.findByIdAndOwner(draftId, ownerUserId);

    if (!current) {
      return null;
    }

    const nextUpdatedAt = new Date().toISOString();
    const query = this.db.query(`
      UPDATE generated_subscription_drafts
      SET
        upstream_source_id = ?,
        display_name = ?,
        current_step = ?,
        shareability_status = ?,
        selected_source_snapshot_id = ?,
        last_preview_yaml = ?,
        updated_at = ?
      WHERE id = ? AND owner_user_id = ?
    `);

    query.run(
      input.upstreamSourceId ?? current.upstreamSourceId,
      input.displayName ?? current.displayName,
      input.currentStep ?? current.currentStep,
      input.shareabilityStatus ?? current.shareabilityStatus,
      input.selectedSourceSnapshotId ?? current.selectedSourceSnapshotId,
      input.lastPreviewYaml ?? current.lastPreviewYaml,
      nextUpdatedAt,
      draftId,
      ownerUserId
    );

    return this.findByIdAndOwner(draftId, ownerUserId);
  }

  upsertStep(input: {
    id: string;
    draftId: string;
    stepKey: DraftStepRow["stepKey"];
    patchMode: DraftStepRow["patchMode"];
    editorMode: DraftStepRow["editorMode"];
    operationsJson: string;
    rawJson: string | null;
    summaryJson: string | null;
  }) {
    const now = new Date().toISOString();
    const query = this.db.query(`
      INSERT INTO generated_subscription_draft_steps (
        id,
        draft_id,
        step_key,
        patch_mode,
        editor_mode,
        operations_json,
        raw_json,
        summary_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(draft_id, step_key) DO UPDATE SET
        patch_mode = excluded.patch_mode,
        editor_mode = excluded.editor_mode,
        operations_json = excluded.operations_json,
        raw_json = excluded.raw_json,
        summary_json = excluded.summary_json,
        updated_at = excluded.updated_at
    `);

    query.run(
      input.id,
      input.draftId,
      input.stepKey,
      input.patchMode,
      input.editorMode,
      input.operationsJson,
      input.rawJson,
      input.summaryJson,
      now,
      now
    );
  }
}
