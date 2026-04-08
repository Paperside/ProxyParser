import type { Database } from "bun:sqlite";

interface SubscriptionSecretRow {
  id: string;
  userId: string;
  secretHash: string;
}

interface TempTokenRow {
  id: string;
  userId: string;
  managedSubscriptionId: string | null;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
}

export class SubscriptionAccessRepository {
  constructor(private readonly db: Database) {}

  findUserSecret(userId: string) {
    const query = this.db.query<SubscriptionSecretRow>(`
      SELECT
        id,
        user_id AS userId,
        secret_hash AS secretHash
      FROM user_subscription_secrets
      WHERE user_id = ?
      LIMIT 1
    `);

    return query.get(userId) ?? null;
  }

  rotateUserSecret(userId: string, secretHash: string) {
    const current = this.findUserSecret(userId);
    const now = new Date().toISOString();

    if (!current) {
      return;
    }

    const query = this.db.query(`
      UPDATE user_subscription_secrets
      SET
        secret_hash = ?,
        rotated_at = ?,
        updated_at = ?
      WHERE user_id = ?
    `);

    query.run(secretHash, now, now, userId);
  }

  createTempToken(input: {
    id: string;
    userId: string;
    managedSubscriptionId: string;
    tokenHash: string;
    expiresAt: string;
  }) {
    const query = this.db.query(`
      INSERT INTO user_subscription_temp_tokens (
        id,
        user_id,
        managed_subscription_id,
        token_hash,
        expires_at,
        revoked_at,
        last_used_at,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
    `);
    const now = new Date().toISOString();

    query.run(
      input.id,
      input.userId,
      input.managedSubscriptionId,
      input.tokenHash,
      input.expiresAt,
      now
    );
  }

  findValidTempToken(tokenHash: string, managedSubscriptionId: string) {
    const query = this.db.query<TempTokenRow>(`
      SELECT
        id,
        user_id AS userId,
        managed_subscription_id AS managedSubscriptionId,
        token_hash AS tokenHash,
        expires_at AS expiresAt,
        revoked_at AS revokedAt
      FROM user_subscription_temp_tokens
      WHERE token_hash = ?
        AND (managed_subscription_id = ? OR managed_subscription_id IS NULL)
      LIMIT 1
    `);

    return query.get(tokenHash, managedSubscriptionId) ?? null;
  }

  touchTempToken(tokenId: string) {
    const query = this.db.query(`
      UPDATE user_subscription_temp_tokens
      SET last_used_at = ?
      WHERE id = ?
    `);

    query.run(new Date().toISOString(), tokenId);
  }
}
