import type { Database } from "bun:sqlite";

import type { ShareMode, TemplateDetail, TemplateSummary, Visibility } from "../../types";
import { createDefaultTemplatePayload, normalizeTemplatePayload } from "../../lib/render/template-payload";

interface TemplateRow {
  id: string;
  ownerUserId: string;
  ownerDisplayName: string | null;
  isOfficial: number;
  displayName: string;
  slug: string | null;
  description: string | null;
  sourceTemplateId: string | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  visibility: Visibility;
  shareMode: ShareMode;
  publishStatus: "draft" | "published" | "archived";
  isInternal: number;
  latestVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  latestVersion: number | null;
}

interface TemplateVersionRow {
  id: string;
  templateId: string;
  version: number;
  versionNote: string | null;
  payloadJson: string;
  exportedYaml: string | null;
  createdAt: string;
}

export interface CreateTemplateInput {
  id: string;
  ownerUserId: string;
  displayName: string;
  slug?: string | null;
  description?: string | null;
  sourceTemplateId?: string | null;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  visibility: Visibility;
  shareMode: ShareMode;
  publishStatus: "draft" | "published" | "archived";
  isInternal?: boolean;
  versionId: string;
  versionNote?: string | null;
  payloadJson: string;
  exportedYaml?: string | null;
}

export interface UpdateTemplateInput {
  displayName?: string;
  slug?: string | null;
  description?: string | null;
  sourceTemplateId?: string | null;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  visibility?: Visibility;
  shareMode?: ShareMode;
  publishStatus?: "draft" | "published" | "archived";
  versionId: string;
  versionNote?: string | null;
  payloadJson: string;
  exportedYaml?: string | null;
}

const TEMPLATE_SELECT = `
  SELECT
    templates.id AS id,
    templates.owner_user_id AS ownerUserId,
    users.display_name AS ownerDisplayName,
    users.is_admin AS isOfficial,
    templates.display_name AS displayName,
    templates.slug AS slug,
    templates.description AS description,
    templates.source_template_id AS sourceTemplateId,
    templates.source_label AS sourceLabel,
    templates.source_url AS sourceUrl,
    templates.visibility AS visibility,
    templates.share_mode AS shareMode,
    templates.publish_status AS publishStatus,
    templates.is_internal AS isInternal,
    templates.latest_version_id AS latestVersionId,
    templates.created_at AS createdAt,
    templates.updated_at AS updatedAt,
    COALESCE(template_versions.version, 0) AS latestVersion
  FROM templates
  LEFT JOIN users
    ON users.id = templates.owner_user_id
  LEFT JOIN template_versions
    ON template_versions.id = templates.latest_version_id
`;

const mapSummary = (row: TemplateRow | null): TemplateSummary | null => {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    ownerDisplayName: row.ownerDisplayName,
    isOfficial: row.isOfficial === 1,
    displayName: row.displayName,
    slug: row.slug,
    description: row.description,
    sourceTemplateId: row.sourceTemplateId,
    sourceLabel: row.sourceLabel,
    sourceUrl: row.sourceUrl,
    visibility: row.visibility,
    shareMode: row.shareMode,
    publishStatus: row.publishStatus,
    latestVersionId: row.latestVersionId,
    latestVersion: row.latestVersion ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
};

export class TemplateRepository {
  constructor(private readonly db: Database) {}

  listByOwner(ownerUserId: string) {
    const query = this.db.query<TemplateRow>(
      `${TEMPLATE_SELECT} WHERE templates.owner_user_id = ? AND templates.is_internal = 0 ORDER BY templates.updated_at DESC`
    );

    return query.all(ownerUserId).map((row) => mapSummary(row)!);
  }

  findByIdAndOwner(id: string, ownerUserId: string) {
    const query = this.db.query<TemplateRow>(
      `${TEMPLATE_SELECT} WHERE templates.id = ? AND templates.owner_user_id = ? LIMIT 1`
    );

    return mapSummary(query.get(id, ownerUserId));
  }

  findPublicById(id: string) {
    const query = this.db.query<TemplateRow>(
      `${TEMPLATE_SELECT} WHERE templates.id = ? AND templates.visibility = 'public' AND templates.publish_status = 'published' AND templates.is_internal = 0 LIMIT 1`
    );

    return mapSummary(query.get(id));
  }

  findLatestVersion(templateId: string) {
    const query = this.db.query<TemplateVersionRow>(`
      SELECT
        id,
        template_id AS templateId,
        version,
        version_note AS versionNote,
        payload_json AS payloadJson,
        exported_yaml AS exportedYaml,
        created_at AS createdAt
      FROM template_versions
      WHERE template_id = ?
      ORDER BY version DESC
      LIMIT 1
    `);

    return query.get(templateId) ?? null;
  }

  findLatestVersionById(versionId: string) {
    const query = this.db.query<TemplateVersionRow>(`
      SELECT
        id,
        template_id AS templateId,
        version,
        version_note AS versionNote,
        payload_json AS payloadJson,
        exported_yaml AS exportedYaml,
        created_at AS createdAt
      FROM template_versions
      WHERE id = ?
      LIMIT 1
    `);

    return query.get(versionId) ?? null;
  }

  create(input: CreateTemplateInput) {
    const now = new Date().toISOString();
    const insertTemplate = this.db.query(`
      INSERT INTO templates (
        id,
        owner_user_id,
        display_name,
        slug,
        description,
        source_template_id,
        source_label,
        source_url,
        visibility,
        share_mode,
        publish_status,
        is_internal,
        latest_version_id,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertVersion = this.db.query(`
      INSERT INTO template_versions (
        id,
        template_id,
        version,
        version_note,
        payload_json,
        exported_yaml,
        created_at
      )
      VALUES (?, ?, 1, ?, ?, ?, ?)
    `);

    this.db.exec("BEGIN");

    try {
      insertTemplate.run(
        input.id,
        input.ownerUserId,
        input.displayName,
        input.slug ?? null,
        input.description ?? null,
        input.sourceTemplateId ?? null,
        input.sourceLabel ?? null,
        input.sourceUrl ?? null,
        input.visibility,
        input.shareMode,
        input.publishStatus,
        input.isInternal ? 1 : 0,
        input.versionId,
        now,
        now
      );
      insertVersion.run(
        input.versionId,
        input.id,
        input.versionNote ?? null,
        input.payloadJson,
        input.exportedYaml ?? null,
        now
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    return this.findDetailByIdAndOwner(input.id, input.ownerUserId);
  }

  update(templateId: string, ownerUserId: string, input: UpdateTemplateInput) {
    const current = this.findByIdAndOwner(templateId, ownerUserId);

    if (!current) {
      return null;
    }

    const nextVersion = current.latestVersion + 1;
    const now = new Date().toISOString();
    const updateTemplate = this.db.query(`
      UPDATE templates
      SET
        display_name = ?,
        slug = ?,
        description = ?,
        source_template_id = ?,
        source_label = ?,
        source_url = ?,
        visibility = ?,
        share_mode = ?,
        publish_status = ?,
        latest_version_id = ?,
        updated_at = ?
      WHERE id = ? AND owner_user_id = ?
    `);
    const insertVersion = this.db.query(`
      INSERT INTO template_versions (
        id,
        template_id,
        version,
        version_note,
        payload_json,
        exported_yaml,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.exec("BEGIN");

    try {
      insertVersion.run(
        input.versionId,
        templateId,
        nextVersion,
        input.versionNote ?? null,
        input.payloadJson,
        input.exportedYaml ?? null,
        now
      );
      updateTemplate.run(
        input.displayName ?? current.displayName,
        input.slug === undefined ? current.slug : input.slug,
        input.description === undefined ? current.description : input.description,
        input.sourceTemplateId === undefined ? current.sourceTemplateId : input.sourceTemplateId,
        input.sourceLabel === undefined ? current.sourceLabel : input.sourceLabel,
        input.sourceUrl === undefined ? current.sourceUrl : input.sourceUrl,
        input.visibility ?? current.visibility,
        input.shareMode ?? current.shareMode,
        input.publishStatus ?? current.publishStatus,
        input.versionId,
        now,
        templateId,
        ownerUserId
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    return this.findDetailByIdAndOwner(templateId, ownerUserId);
  }

  delete(templateId: string, ownerUserId: string) {
    const query = this.db.query(`
      DELETE FROM templates
      WHERE id = ? AND owner_user_id = ?
    `);

    return query.run(templateId, ownerUserId).changes > 0;
  }

  findDetailByIdAndOwner(id: string, ownerUserId: string): TemplateDetail | null {
    const template = this.findByIdAndOwner(id, ownerUserId);

    if (!template) {
      return null;
    }

    const version = template.latestVersionId
      ? this.findLatestVersionById(template.latestVersionId)
      : null;

    return {
      ...template,
      payload: version ? normalizeTemplatePayload(JSON.parse(version.payloadJson)) : createDefaultTemplatePayload(),
      exportedYaml: version?.exportedYaml ?? null,
      versionNote: version?.versionNote ?? null
    };
  }

  findPublicDetailById(id: string): TemplateDetail | null {
    const template = this.findPublicById(id);

    if (!template) {
      return null;
    }

    const version = template.latestVersionId
      ? this.findLatestVersionById(template.latestVersionId)
      : null;

    return {
      ...template,
      payload: version ? normalizeTemplatePayload(JSON.parse(version.payloadJson)) : createDefaultTemplatePayload(),
      exportedYaml: version?.exportedYaml ?? null,
      versionNote: version?.versionNote ?? null
    };
  }
}
