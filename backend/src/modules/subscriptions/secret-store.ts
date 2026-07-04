import type { Database } from "bun:sqlite";

import { createId } from "../../lib/ids";
import type { SecretBox } from "../../lib/security/secret-box";

// 自建节点敏感字段存取（custom_node_secrets，AES-256-GCM）。
// BuildConfig 与模板只持有 secretRef，明文永不落库。

export class SecretStore {
  constructor(
    private readonly db: Database,
    private readonly box: SecretBox
  ) {}

  create(ownerUserId: string, fields: Record<string, unknown>): string {
    const id = createId("sec");
    const now = new Date().toISOString();
    this.db
      .query(
        "INSERT INTO custom_node_secrets (id, owner_user_id, ciphertext, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(id, ownerUserId, this.box.encrypt(fields), now, now);
    return id;
  }

  update(ownerUserId: string, id: string, fields: Record<string, unknown>): boolean {
    const result = this.db
      .query(
        "UPDATE custom_node_secrets SET ciphertext = ?, updated_at = ? WHERE id = ? AND owner_user_id = ?"
      )
      .run(this.box.encrypt(fields), new Date().toISOString(), id, ownerUserId);
    return result.changes > 0;
  }

  resolve(id: string): Record<string, unknown> | null {
    const row = this.db
      .query<{ ciphertext: Uint8Array }>(
        "SELECT ciphertext FROM custom_node_secrets WHERE id = ?"
      )
      .get(id);
    if (!row) return null;
    try {
      return this.box.decrypt(row.ciphertext);
    } catch {
      return null;
    }
  }

  delete(ownerUserId: string, id: string) {
    this.db
      .query("DELETE FROM custom_node_secrets WHERE id = ? AND owner_user_id = ?")
      .run(id, ownerUserId);
  }

  // 展示层：只暴露有哪些字段，不暴露值
  fieldNames(id: string): string[] {
    const fields = this.resolve(id);
    return fields ? Object.keys(fields) : [];
  }
}
