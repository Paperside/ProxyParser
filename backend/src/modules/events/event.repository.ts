import type { Database } from "bun:sqlite";

import { createId } from "../../lib/ids";

export interface EventRecord {
  id: string;
  ownerUserId: string;
  entityKind: "source" | "subscription" | "ruleset";
  entityId: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface EventRow {
  id: string;
  owner_user_id: string;
  entity_kind: string;
  entity_id: string;
  kind: string;
  payload: string;
  created_at: string;
}

const mapEvent = (row: EventRow): EventRecord => ({
  id: row.id,
  ownerUserId: row.owner_user_id,
  entityKind: row.entity_kind as EventRecord["entityKind"],
  entityId: row.entity_id,
  kind: row.kind,
  payload: JSON.parse(row.payload) as Record<string, unknown>,
  createdAt: row.created_at
});

export class EventRepository {
  constructor(private readonly db: Database) {}

  insert(input: {
    ownerUserId: string;
    entityKind: EventRecord["entityKind"];
    entityId: string;
    kind: string;
    payload: Record<string, unknown>;
  }) {
    this.db
      .query(
        `INSERT INTO events (id, owner_user_id, entity_kind, entity_id, kind, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        createId("evt"),
        input.ownerUserId,
        input.entityKind,
        input.entityId,
        input.kind,
        JSON.stringify(input.payload),
        new Date().toISOString()
      );
  }

  // 官方规则源更新：通知所有在 BuildConfig 中引用了该规则源的用户
  insertForAll(input: {
    entityKind: EventRecord["entityKind"];
    entityId: string;
    kind: string;
    payload: Record<string, unknown>;
  }) {
    const owners = this.db
      .query<{ owner_user_id: string }>(
        `SELECT DISTINCT owner_user_id FROM subscriptions
         WHERE (build_config LIKE ?1 OR draft_build_config LIKE ?1)`
      )
      .all(`%${input.entityId}%`);
    for (const owner of owners) {
      this.insert({ ...input, ownerUserId: owner.owner_user_id });
    }
  }

  listByOwner(ownerUserId: string, limit = 50): EventRecord[] {
    return this.db
      .query<EventRow>(
        `SELECT * FROM events WHERE owner_user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`
      )
      .all(ownerUserId, limit)
      .map(mapEvent);
  }
}
