import type { Database } from "bun:sqlite";

import { createId } from "../../lib/ids";
import type { TemplateExtractionReport, TemplatePayloadV2 } from "../../lib/build-config/types";

export interface TemplateSummary {
  id: string;
  ownerUserId: string;
  displayName: string;
  slug: string | null;
  description: string | null;
  visibility: "private" | "unlisted" | "public";
  isOfficial: boolean;
  latestVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateDetail extends TemplateSummary {
  payload: TemplatePayloadV2 | null;
  extractionReport: TemplateExtractionReport | null;
}

interface TemplateRow {
  id: string;
  owner_user_id: string;
  display_name: string;
  slug: string | null;
  description: string | null;
  visibility: string;
  is_official: number;
  latest_version_id: string | null;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  id: string;
  template_id: string;
  version: number;
  payload_json: string;
  extraction_report: string | null;
  created_at: string;
}

const mapSummary = (row: TemplateRow, latestVersion: number): TemplateSummary => ({
  id: row.id,
  ownerUserId: row.owner_user_id,
  displayName: row.display_name,
  slug: row.slug,
  description: row.description,
  visibility: row.visibility as TemplateSummary["visibility"],
  isOfficial: row.is_official === 1,
  latestVersion,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export class TemplateRepository {
  constructor(private readonly db: Database) {}

  private latestVersionOf(templateId: string): VersionRow | null {
    return (
      this.db
        .query<VersionRow>(
          "SELECT * FROM template_versions WHERE template_id = ? ORDER BY version DESC LIMIT 1"
        )
        .get(templateId) ?? null
    );
  }

  listVisible(userId: string): TemplateSummary[] {
    return this.db
      .query<TemplateRow>(
        `SELECT * FROM templates
         WHERE owner_user_id = ? OR is_official = 1 OR visibility = 'public'
         ORDER BY is_official DESC, updated_at DESC`
      )
      .all(userId)
      .map((row) => mapSummary(row, this.latestVersionOf(row.id)?.version ?? 0));
  }

  findDetailVisibleTo(id: string, userId: string): TemplateDetail | null {
    const row = this.db.query<TemplateRow>("SELECT * FROM templates WHERE id = ?").get(id);
    if (!row) return null;
    const visible =
      row.owner_user_id === userId ||
      row.is_official === 1 ||
      row.visibility === "public" ||
      row.visibility === "unlisted";
    if (!visible) return null;
    const version = this.latestVersionOf(id);
    return {
      ...mapSummary(row, version?.version ?? 0),
      payload: version ? (JSON.parse(version.payload_json) as TemplatePayloadV2) : null,
      extractionReport: version?.extraction_report
        ? (JSON.parse(version.extraction_report) as TemplateExtractionReport)
        : null
    };
  }

  findLatestPayload(id: string): TemplatePayloadV2 | null {
    const version = this.latestVersionOf(id);
    return version ? (JSON.parse(version.payload_json) as TemplatePayloadV2) : null;
  }

  findLatestPayloadVisibleTo(id: string, userId: string): TemplatePayloadV2 | null {
    const detail = this.findDetailVisibleTo(id, userId);
    return detail?.payload ?? null;
  }

  create(input: {
    ownerUserId: string;
    displayName: string;
    description: string | null;
    visibility: TemplateSummary["visibility"];
    payload: TemplatePayloadV2;
    extractionReport: TemplateExtractionReport | null;
    versionNote: string | null;
  }): TemplateDetail {
    const id = createId("tpl");
    const versionId = createId("tplv");
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      this.db
        .query(
          `INSERT INTO templates (id, owner_user_id, display_name, slug, description, visibility, is_official, latest_version_id, created_at, updated_at)
           VALUES (?, ?, ?, NULL, ?, ?, 0, ?, ?, ?)`
        )
        .run(id, input.ownerUserId, input.displayName, input.description, input.visibility, versionId, now, now);
      this.db
        .query(
          `INSERT INTO template_versions (id, template_id, version, version_note, payload_json, extraction_report, created_at)
           VALUES (?, ?, 1, ?, ?, ?, ?)`
        )
        .run(
          versionId,
          id,
          input.versionNote,
          JSON.stringify(input.payload),
          input.extractionReport ? JSON.stringify(input.extractionReport) : null,
          now
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.findDetailVisibleTo(id, input.ownerUserId)!;
  }

  addVersion(
    templateId: string,
    payload: TemplatePayloadV2,
    extractionReport: TemplateExtractionReport | null,
    versionNote: string | null
  ) {
    const versionId = createId("tplv");
    const now = new Date().toISOString();
    const next = (this.latestVersionOf(templateId)?.version ?? 0) + 1;
    this.db.exec("BEGIN");
    try {
      this.db
        .query(
          `INSERT INTO template_versions (id, template_id, version, version_note, payload_json, extraction_report, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          versionId,
          templateId,
          next,
          versionNote,
          JSON.stringify(payload),
          extractionReport ? JSON.stringify(extractionReport) : null,
          now
        );
      this.db
        .query("UPDATE templates SET latest_version_id = ?, updated_at = ? WHERE id = ?")
        .run(versionId, now, templateId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return next;
  }

  updateMeta(
    id: string,
    ownerUserId: string,
    patch: Partial<{ displayName: string; description: string; visibility: TemplateSummary["visibility"] }>
  ): boolean {
    const row = this.db
      .query<TemplateRow>("SELECT * FROM templates WHERE id = ? AND owner_user_id = ?")
      .get(id, ownerUserId);
    if (!row) return false;
    this.db
      .query(
        "UPDATE templates SET display_name = ?, description = ?, visibility = ?, updated_at = ? WHERE id = ?"
      )
      .run(
        patch.displayName ?? row.display_name,
        patch.description ?? row.description,
        patch.visibility ?? row.visibility,
        new Date().toISOString(),
        id
      );
    return true;
  }

  deleteOwned(id: string, ownerUserId: string): boolean {
    const result = this.db
      .query("DELETE FROM templates WHERE id = ? AND owner_user_id = ? AND is_official = 0")
      .run(id, ownerUserId);
    return result.changes > 0;
  }
}
