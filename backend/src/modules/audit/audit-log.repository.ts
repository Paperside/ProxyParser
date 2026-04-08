import type { Database } from "bun:sqlite";

import { createId } from "../../lib/ids";

interface AuditLogRow {
  id: string;
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  summary: string | null;
  beforeJson: string | null;
  afterJson: string | null;
  createdAt: string;
}

export interface AuditLogRecord {
  id: string;
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  summary: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

export interface CreateAuditLogInput {
  actorUserId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  summary?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

const AUDIT_LOG_SELECT = `
  SELECT
    id,
    actor_user_id AS actorUserId,
    entity_type AS entityType,
    entity_id AS entityId,
    action,
    summary,
    before_json AS beforeJson,
    after_json AS afterJson,
    created_at AS createdAt
  FROM audit_logs
`;

const parseJsonObject = (value: string | null) => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const mapAuditLog = (row: AuditLogRow | null): AuditLogRecord | null => {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    actorUserId: row.actorUserId,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    summary: row.summary,
    before: parseJsonObject(row.beforeJson),
    after: parseJsonObject(row.afterJson),
    createdAt: row.createdAt
  };
};

export class AuditLogRepository {
  private readonly insertAuditLog;

  constructor(private readonly db: Database) {
    this.insertAuditLog = this.db.query(`
      INSERT INTO audit_logs (
        id,
        actor_user_id,
        entity_type,
        entity_id,
        action,
        summary,
        before_json,
        after_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  create(input: CreateAuditLogInput) {
    const id = createId("audit");
    const createdAt = new Date().toISOString();

    this.insertAuditLog.run(
      id,
      input.actorUserId ?? null,
      input.entityType,
      input.entityId,
      input.action,
      input.summary ?? null,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
      createdAt
    );

    return this.findById(id);
  }

  findById(id: string) {
    const query = this.db.query<AuditLogRow>(`${AUDIT_LOG_SELECT} WHERE id = ? LIMIT 1`);
    return mapAuditLog(query.get(id));
  }

  listByActor(actorUserId: string, limit = 20) {
    const query = this.db.query<AuditLogRow>(`
      ${AUDIT_LOG_SELECT}
      WHERE actor_user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    return query.all(actorUserId, limit).flatMap((row) => {
      const item = mapAuditLog(row);
      return item ? [item] : [];
    });
  }
}
