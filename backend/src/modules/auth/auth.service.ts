import type { Database } from "bun:sqlite";

import type { RuntimeConfig } from "../../lib/runtime-config";
import { createId } from "../../lib/ids";
import { hashPassword, verifyPassword } from "../../lib/auth/password";
import {
  createAccessToken,
  createOpaqueToken,
  hashOpaqueToken,
  verifyAccessToken
} from "../../lib/auth/tokens";
import {
  UserRepository,
  type AuthUserRecord,
  type UserRecord,
  type UpdateUserProfileInput
} from "../users/user.repository";

interface RefreshTokenRow {
  id: string;
  userId: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface RegisterInput {
  email: string;
  username: string;
  password: string;
  displayName?: string;
  locale?: string;
}

export interface LoginInput {
  login: string;
  password: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export class AuthService {
  private readonly users: UserRepository;
  private readonly insertRefreshToken;
  private readonly findRefreshTokenByHash;
  private readonly revokeRefreshTokenById;
  private readonly revokeRefreshTokenByHash;

  constructor(
    private readonly db: Database,
    private readonly config: RuntimeConfig
  ) {
    this.users = new UserRepository(db);
    this.insertRefreshToken = this.db.query(`
      INSERT INTO user_refresh_tokens (
        id,
        user_id,
        token_hash,
        expires_at,
        revoked_at,
        last_used_at,
        created_at
      )
      VALUES (?, ?, ?, ?, NULL, NULL, ?)
    `);
    this.findRefreshTokenByHash = this.db.query<RefreshTokenRow>(`
      SELECT
        id,
        user_id AS userId,
        expires_at AS expiresAt,
        revoked_at AS revokedAt
      FROM user_refresh_tokens
      WHERE token_hash = ?
      LIMIT 1
    `);
    this.revokeRefreshTokenById = this.db.query(`
      UPDATE user_refresh_tokens
      SET revoked_at = COALESCE(revoked_at, ?)
      WHERE id = ?
    `);
    this.revokeRefreshTokenByHash = this.db.query(`
      UPDATE user_refresh_tokens
      SET revoked_at = COALESCE(revoked_at, ?)
      WHERE token_hash = ?
    `);
  }

  async register(input: RegisterInput) {
    const email = input.email.trim().toLowerCase();
    const username = input.username.trim();

    if (this.users.findByEmail(email)) {
      throw new AuthError("该邮箱已被注册。", 409);
    }

    if (this.users.findByUsername(username)) {
      throw new AuthError("该用户名已被占用。", 409);
    }

    const passwordHash = await hashPassword(input.password);
    const subscriptionSecret = createOpaqueToken(48);
    const createdUser = this.users.create({
      id: createId("usr"),
      email,
      username,
      displayName: input.displayName?.trim() || username,
      locale: input.locale?.trim() || this.config.defaultLocale,
      passwordHash,
      subscriptionSecretId: createId("subs"),
      subscriptionSecretHash: hashOpaqueToken(subscriptionSecret)
    });

    if (!createdUser) {
      throw new AuthError("创建用户失败。", 500);
    }

    const tokens = this.issueTokens(createdUser);

    return {
      user: createdUser,
      tokens,
      subscriptionSecret
    };
  }

  async login(input: LoginInput) {
    const authUser = this.users.findForLogin(input.login.trim());

    if (!authUser) {
      throw new AuthError("账号或密码错误。", 401);
    }

    await this.ensureUserCanLogin(authUser);

    const passwordMatches = await verifyPassword(input.password, authUser.passwordHash);

    if (!passwordMatches) {
      throw new AuthError("账号或密码错误。", 401);
    }

    return {
      user: this.toPublicUser(authUser),
      tokens: this.issueTokens(authUser)
    };
  }

  refresh(refreshToken: string) {
    const normalizedToken = refreshToken.trim();

    if (!normalizedToken) {
      throw new AuthError("缺少 refresh token。", 400);
    }

    const tokenHash = hashOpaqueToken(normalizedToken);
    const tokenRecord = this.findRefreshTokenByHash.get(tokenHash);

    if (!tokenRecord || tokenRecord.revokedAt) {
      throw new AuthError("refresh token 无效。", 401);
    }

    if (new Date(tokenRecord.expiresAt).getTime() <= Date.now()) {
      this.revokeRefreshTokenById.run(new Date().toISOString(), tokenRecord.id);
      throw new AuthError("refresh token 已过期。", 401);
    }

    const user = this.users.findById(tokenRecord.userId);

    if (!user || user.status !== "active") {
      throw new AuthError("用户不存在或已被禁用。", 401);
    }

    this.revokeRefreshTokenById.run(new Date().toISOString(), tokenRecord.id);

    return {
      user,
      tokens: this.issueTokens(user)
    };
  }

  logout(refreshToken: string) {
    const normalizedToken = refreshToken.trim();

    if (!normalizedToken) {
      throw new AuthError("缺少 refresh token。", 400);
    }

    this.revokeRefreshTokenByHash.run(new Date().toISOString(), hashOpaqueToken(normalizedToken));
  }

  authenticate(authorizationHeader: string | null | undefined) {
    const token = this.extractBearerToken(authorizationHeader);

    if (!token) {
      throw new AuthError("缺少访问令牌。", 401);
    }

    const payload = verifyAccessToken({
      token,
      issuer: this.config.jwtIssuer,
      secret: this.config.jwtSecret
    });

    if (!payload) {
      throw new AuthError("访问令牌无效或已过期。", 401);
    }

    const user = this.users.findById(payload.sub);

    if (!user || user.status !== "active") {
      throw new AuthError("用户不存在或已被禁用。", 401);
    }

    return user;
  }

  updateProfile(userId: string, input: UpdateUserProfileInput) {
    const updated = this.users.updateProfile(userId, input);

    if (!updated) {
      throw new AuthError("用户不存在。", 404);
    }

    return updated;
  }

  private async ensureUserCanLogin(user: AuthUserRecord) {
    if (user.status !== "active") {
      throw new AuthError("当前用户已被禁用。", 403);
    }
  }

  private toPublicUser(user: AuthUserRecord | UserRecord): UserRecord {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      locale: user.locale,
      status: user.status,
      isAdmin: user.isAdmin,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }

  private issueTokens(user: UserRecord) {
    const accessToken = createAccessToken({
      userId: user.id,
      username: user.username,
      issuer: this.config.jwtIssuer,
      secret: this.config.jwtSecret,
      ttlSeconds: this.config.jwtAccessTtlSeconds
    });
    const refreshToken = createOpaqueToken(48);
    const refreshTokenExpiresAt = new Date(
      Date.now() + this.config.jwtRefreshTtlSeconds * 1000
    ).toISOString();

    this.insertRefreshToken.run(
      createId("rt"),
      user.id,
      hashOpaqueToken(refreshToken),
      refreshTokenExpiresAt,
      new Date().toISOString()
    );

    return {
      accessToken: accessToken.token,
      accessTokenExpiresAt: accessToken.expiresAt,
      refreshToken,
      refreshTokenExpiresAt
    };
  }

  private extractBearerToken(value: string | null | undefined) {
    if (!value) {
      return null;
    }

    const [scheme, token] = value.split(" ");

    if (scheme?.toLowerCase() !== "bearer" || !token) {
      return null;
    }

    return token.trim();
  }
}
