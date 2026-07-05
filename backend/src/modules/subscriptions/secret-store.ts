import type { Database } from "bun:sqlite";

import { createId } from "../../lib/ids";
import { splitFields } from "../../lib/nodes/split-fields";
import type { SecretBox } from "../../lib/security/secret-box";

// 自建节点敏感字段存取（custom_node_secrets，AES-256-GCM）。
// BuildConfig 与模板只持有 secretRef，明文永不落库。

export interface SplitUpsertResult {
  secretRef: string | null;
  extra: Record<string, unknown>;
}

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

  // 供编辑弹窗回显：校验 owner 后解密。与 resolve() 的区别是不信任调用方已做过归属校验。
  resolveForOwner(ownerUserId: string, id: string): Record<string, unknown> | null {
    const row = this.db
      .query<{ ciphertext: Uint8Array }>(
        "SELECT ciphertext FROM custom_node_secrets WHERE id = ? AND owner_user_id = ?"
      )
      .get(id, ownerUserId);
    if (!row) return null;
    try {
      return this.box.decrypt(row.ciphertext);
    } catch {
      return null;
    }
  }

  // 用户视角只填一张表单：这里按协议 schema 把字段拆成密文/明文两份，
  // 并根据 existingSecretRef 决定新建 / 原地更新 / 删除孤儿记录。
  upsertSplit(
    ownerUserId: string,
    type: string,
    fields: Record<string, unknown>,
    existingSecretRef: string | null
  ): SplitUpsertResult {
    const { secretFields, extra } = splitFields(type, fields);
    const hasSecret = Object.keys(secretFields).length > 0;

    if (!hasSecret) {
      if (existingSecretRef) this.delete(ownerUserId, existingSecretRef);
      return { secretRef: null, extra };
    }

    if (existingSecretRef && this.update(ownerUserId, existingSecretRef, secretFields)) {
      return { secretRef: existingSecretRef, extra };
    }

    return { secretRef: this.create(ownerUserId, secretFields), extra };
  }

  delete(ownerUserId: string, id: string) {
    this.db
      .query("DELETE FROM custom_node_secrets WHERE id = ? AND owner_user_id = ?")
      .run(id, ownerUserId);
  }
}
