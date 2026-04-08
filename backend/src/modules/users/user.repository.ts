import type { Database } from "bun:sqlite";

interface UserRow {
  id: string;
  email: string;
  username: string;
  displayName: string;
  locale: string;
  status: "active" | "disabled";
  isAdmin: number;
  createdAt: string;
  updatedAt: string;
}

interface AuthUserRow extends UserRow {
  passwordHash: string;
}

export interface UserRecord {
  id: string;
  email: string;
  username: string;
  displayName: string;
  locale: string;
  status: "active" | "disabled";
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthUserRecord extends UserRecord {
  passwordHash: string;
}

export interface CreateUserInput {
  id: string;
  email: string;
  username: string;
  displayName: string;
  locale: string;
  passwordHash: string;
  subscriptionSecretId: string;
  subscriptionSecretHash: string;
}

export interface UpdateUserProfileInput {
  displayName?: string;
  locale?: string;
}

const USER_SELECT = `
  SELECT
    id,
    email,
    username,
    display_name AS displayName,
    locale,
    status,
    is_admin AS isAdmin,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM users
`;

const AUTH_USER_SELECT = `
  SELECT
    users.id AS id,
    users.email AS email,
    users.username AS username,
    users.display_name AS displayName,
    users.locale AS locale,
    users.status AS status,
    users.is_admin AS isAdmin,
    users.created_at AS createdAt,
    users.updated_at AS updatedAt,
    user_passwords.password_hash AS passwordHash
  FROM users
  INNER JOIN user_passwords
    ON user_passwords.user_id = users.id
`;

const mapUser = (row: UserRow | null): UserRecord | null => {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.displayName,
    locale: row.locale,
    status: row.status,
    isAdmin: row.isAdmin === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
};

const mapAuthUser = (row: AuthUserRow | null): AuthUserRecord | null => {
  const user = mapUser(row);

  if (!user || !row) {
    return null;
  }

  return {
    ...user,
    passwordHash: row.passwordHash
  };
};

export class UserRepository {
  constructor(private readonly db: Database) {}

  findById(id: string) {
    const query = this.db.query<UserRow>(`${USER_SELECT} WHERE id = ? LIMIT 1`);
    return mapUser(query.get(id));
  }

  findByEmail(email: string) {
    const query = this.db.query<UserRow>(`${USER_SELECT} WHERE email = ? LIMIT 1`);
    return mapUser(query.get(email));
  }

  findByUsername(username: string) {
    const query = this.db.query<UserRow>(`${USER_SELECT} WHERE username = ? LIMIT 1`);
    return mapUser(query.get(username));
  }

  findForLogin(login: string) {
    const query = this.db.query<AuthUserRow>(
      `${AUTH_USER_SELECT} WHERE users.email = ? OR users.username = ? LIMIT 1`
    );

    return mapAuthUser(query.get(login, login));
  }

  create(input: CreateUserInput) {
    const now = new Date().toISOString();
    const insertUser = this.db.query(`
      INSERT INTO users (
        id,
        email,
        username,
        display_name,
        locale,
        status,
        is_admin,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?)
    `);
    const insertPassword = this.db.query(`
      INSERT INTO user_passwords (
        user_id,
        password_hash,
        updated_at
      )
      VALUES (?, ?, ?)
    `);
    const insertSubscriptionSecret = this.db.query(`
      INSERT INTO user_subscription_secrets (
        id,
        user_id,
        secret_hash,
        rotated_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.db.exec("BEGIN");

    try {
      insertUser.run(
        input.id,
        input.email,
        input.username,
        input.displayName,
        input.locale,
        now,
        now
      );
      insertPassword.run(input.id, input.passwordHash, now);
      insertSubscriptionSecret.run(
        input.subscriptionSecretId,
        input.id,
        input.subscriptionSecretHash,
        now,
        now,
        now
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    return this.findById(input.id);
  }

  updateProfile(userId: string, input: UpdateUserProfileInput) {
    const current = this.findById(userId);

    if (!current) {
      return null;
    }

    const query = this.db.query(`
      UPDATE users
      SET
        display_name = ?,
        locale = ?,
        updated_at = ?
      WHERE id = ?
    `);

    query.run(
      input.displayName ?? current.displayName,
      input.locale ?? current.locale,
      new Date().toISOString(),
      userId
    );

    return this.findById(userId);
  }
}
