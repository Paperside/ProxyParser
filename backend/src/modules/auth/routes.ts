import { Elysia } from "elysia";

import { logger } from "../../lib/logging/logger";
import {
  applyRateLimitHeaders,
  InMemoryRateLimiter,
  type RateLimitPolicy,
  resolveRateLimitSubject
} from "../../lib/security/rate-limiter";
import type { AuditLogService } from "../audit/audit-log.service";
import { AuthError, type AuthService } from "./auth.service";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const requireString = (
  source: Record<string, unknown>,
  key: string,
  label: string
) => {
  const value = source[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AuthError(`${label}不能为空。`, 400);
  }

  return value.trim();
};

const optionalString = (source: Record<string, unknown>, key: string) => {
  const value = source[key];

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
};

const parseRegisterBody = (body: unknown) => {
  if (!isRecord(body)) {
    throw new AuthError("请求体格式错误。", 400);
  }

  const email = requireString(body, "email", "邮箱");
  const username = requireString(body, "username", "用户名");
  const password = requireString(body, "password", "密码");
  const displayName = optionalString(body, "displayName");
  const locale = optionalString(body, "locale");

  if (!email.includes("@")) {
    throw new AuthError("邮箱格式不正确。", 400);
  }

  if (username.length < 3) {
    throw new AuthError("用户名至少需要 3 个字符。", 400);
  }

  if (password.length < 8) {
    throw new AuthError("密码至少需要 8 个字符。", 400);
  }

  return {
    email,
    username,
    password,
    displayName,
    locale
  };
};

const parseLoginBody = (body: unknown) => {
  if (!isRecord(body)) {
    throw new AuthError("请求体格式错误。", 400);
  }

  return {
    login: requireString(body, "login", "登录账号"),
    password: requireString(body, "password", "密码")
  };
};

const parseRefreshBody = (body: unknown) => {
  if (!isRecord(body)) {
    throw new AuthError("请求体格式错误。", 400);
  }

  return {
    refreshToken: requireString(body, "refreshToken", "refresh token")
  };
};

const parseProfileBody = (body: unknown) => {
  if (!isRecord(body)) {
    throw new AuthError("请求体格式错误。", 400);
  }

  const displayName = optionalString(body, "displayName");
  const locale = optionalString(body, "locale");

  if (!displayName && !locale) {
    throw new AuthError("至少需要提供一个可更新字段。", 400);
  }

  return {
    displayName,
    locale
  };
};

const sendAuthError = (
  error: unknown,
  set: { status?: number | string }
) => {
  if (error instanceof AuthError) {
    set.status = error.status;
    return {
      message: error.message
    };
  }

  throw error;
};

const registerPolicy = {
  keyPrefix: "auth:register",
  limit: 10,
  windowMs: 5 * 60 * 1000
} as const;

const loginPolicy = {
  keyPrefix: "auth:login",
  limit: 12,
  windowMs: 5 * 60 * 1000
} as const;

const refreshPolicy = {
  keyPrefix: "auth:refresh",
  limit: 30,
  windowMs: 5 * 60 * 1000
} as const;

const enforceRateLimit = (
  limiter: InMemoryRateLimiter,
  policy: RateLimitPolicy,
  request: Request,
  set: { headers?: Record<string, string | number | string[] | undefined> }
) => {
  const result = limiter.consume(resolveRateLimitSubject(request), policy);
  applyRateLimitHeaders(set, result);

  if (!result.allowed) {
    throw new AuthError("请求过于频繁，请稍后再试。", 429);
  }
};

export const createAuthRoutes = (
  authService: AuthService,
  auditLogService: AuditLogService,
  rateLimiter: InMemoryRateLimiter
) => {
  return new Elysia({ prefix: "/api" })
    .post("/auth/register", async ({ body, request, set }) => {
      try {
        enforceRateLimit(rateLimiter, registerPolicy, request, set);
        const result = await authService.register(parseRegisterBody(body));
        auditLogService.record({
          actorUserId: result.user.id,
          entityType: "user",
          entityId: result.user.id,
          action: "auth.register",
          summary: "注册新账号并初始化订阅秘钥。"
        });
        logger.info({
          event: "auth.register.success",
          userId: result.user.id,
          username: result.user.username
        });
        set.status = 201;

        return result;
      } catch (error) {
        logger.warn({
          event: "auth.register.failed",
          reason: error instanceof Error ? error.message : String(error)
        });
        return sendAuthError(error, set);
      }
    })
    .post("/auth/login", async ({ body, request, set }) => {
      try {
        enforceRateLimit(rateLimiter, loginPolicy, request, set);
        const result = await authService.login(parseLoginBody(body));
        auditLogService.record({
          actorUserId: result.user.id,
          entityType: "user",
          entityId: result.user.id,
          action: "auth.login",
          summary: "登录成功。"
        });
        logger.info({
          event: "auth.login.success",
          userId: result.user.id,
          username: result.user.username
        });
        return result;
      } catch (error) {
        logger.warn({
          event: "auth.login.failed",
          reason: error instanceof Error ? error.message : String(error)
        });
        return sendAuthError(error, set);
      }
    })
    .post("/auth/refresh", async ({ body, request, set }) => {
      try {
        enforceRateLimit(rateLimiter, refreshPolicy, request, set);
        const result = authService.refresh(parseRefreshBody(body).refreshToken);
        auditLogService.record({
          actorUserId: result.user.id,
          entityType: "user",
          entityId: result.user.id,
          action: "auth.refresh",
          summary: "刷新访问令牌。"
        });
        logger.info({
          event: "auth.refresh.success",
          userId: result.user.id
        });
        return result;
      } catch (error) {
        logger.warn({
          event: "auth.refresh.failed",
          reason: error instanceof Error ? error.message : String(error)
        });
        return sendAuthError(error, set);
      }
    })
    .post("/auth/logout", async ({ body, request, set }) => {
      try {
        enforceRateLimit(rateLimiter, refreshPolicy, request, set);
        authService.logout(parseRefreshBody(body).refreshToken);
        logger.info({
          event: "auth.logout.success"
        });
        return {
          success: true
        };
      } catch (error) {
        logger.warn({
          event: "auth.logout.failed",
          reason: error instanceof Error ? error.message : String(error)
        });
        return sendAuthError(error, set);
      }
    })
    .get("/me", ({ headers, set }) => {
      try {
        return {
          user: authService.authenticate(headers.authorization)
        };
      } catch (error) {
        return sendAuthError(error, set);
      }
    })
    .patch("/me", ({ headers, body, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        const previous = {
          displayName: user.displayName,
          locale: user.locale
        };
        const nextProfile = parseProfileBody(body);
        const updatedUser = authService.updateProfile(user.id, nextProfile);
        auditLogService.record({
          actorUserId: user.id,
          entityType: "user",
          entityId: user.id,
          action: "user.profile.update",
          summary: "更新个人资料。",
          before: previous,
          after: {
            displayName: updatedUser.displayName,
            locale: updatedUser.locale
          }
        });
        logger.info({
          event: "user.profile.updated",
          userId: user.id
        });

        return {
          user: updatedUser
        };
      } catch (error) {
        return sendAuthError(error, set);
      }
    });
};
