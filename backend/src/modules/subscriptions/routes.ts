import { Elysia } from "elysia";

import { logger } from "../../lib/logging/logger";
import {
  applyRateLimitHeaders,
  InMemoryRateLimiter,
  resolveRateLimitSubject
} from "../../lib/security/rate-limiter";
import type { AuditLogService } from "../audit/audit-log.service";
import { AuthError, type AuthService } from "../auth/auth.service";
import { ManagedSubscriptionError, ManagedSubscriptionService } from "./managed-subscription.service";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const optionalString = (source: Record<string, unknown>, key: string) => {
  const value = source[key];

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const optionalBoolean = (source: Record<string, unknown>, key: string) => {
  const value = source[key];
  return typeof value === "boolean" ? value : undefined;
};

const optionalNumber = (source: Record<string, unknown>, key: string) => {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const parseSubscriptionBody = (body: unknown) => {
  if (!isRecord(body)) {
    throw new ManagedSubscriptionError("请求体格式错误。", 400);
  }

  return {
    upstreamSourceId: optionalString(body, "upstreamSourceId"),
    templateId: optionalString(body, "templateId"),
    displayName: optionalString(body, "displayName"),
    visibility: optionalString(body, "visibility") as
      | "private"
      | "unlisted"
      | "public"
      | undefined,
    shareMode: optionalString(body, "shareMode") as
      | "disabled"
      | "view"
      | "fork"
      | undefined,
    isEnabled: optionalBoolean(body, "isEnabled")
  };
};

const parseCompareQuery = (query: Record<string, unknown>) => {
  return {
    baseSnapshotId: typeof query.baseSnapshotId === "string" ? query.baseSnapshotId : "",
    targetSnapshotId: typeof query.targetSnapshotId === "string" ? query.targetSnapshotId : ""
  };
};

const sendSubscriptionError = (
  error: unknown,
  set: { status?: number | string }
) => {
  if (error instanceof AuthError) {
    set.status = error.status;
    return {
      message: error.message
    };
  }

  if (error instanceof ManagedSubscriptionError) {
    set.status = error.status;
    return {
      message: error.message
    };
  }

  throw error;
};

export const createManagedSubscriptionRoutes = (
  authService: AuthService,
  managedSubscriptionService: ManagedSubscriptionService,
  auditLogService: AuditLogService
) => {
  return new Elysia({ prefix: "/api/subscriptions" })
    .get("/", ({ headers, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        return managedSubscriptionService.listByOwner(user.id);
      } catch (error) {
        return sendSubscriptionError(error, set);
      }
    })
    .post("/", ({ headers, body, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        const parsed = parseSubscriptionBody(body);

        if (!parsed.displayName || !parsed.upstreamSourceId || !parsed.templateId) {
          throw new ManagedSubscriptionError("名称、上游订阅源和模板不能为空。", 400);
        }

        const created = managedSubscriptionService.create(user.id, {
          displayName: parsed.displayName,
          upstreamSourceId: parsed.upstreamSourceId,
          templateId: parsed.templateId,
          visibility: parsed.visibility,
          shareMode: parsed.shareMode
        });

        set.status = 201;
        return created;
      } catch (error) {
        return sendSubscriptionError(error, set);
      }
    })
    .get("/:id", ({ headers, params, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        return managedSubscriptionService.getById(user.id, params.id);
      } catch (error) {
        return sendSubscriptionError(error, set);
      }
    })
    .get("/:id/snapshots", ({ headers, params, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        return managedSubscriptionService.listSnapshots(user.id, params.id);
      } catch (error) {
        return sendSubscriptionError(error, set);
      }
    })
    .get("/:id/snapshots/compare", ({ headers, params, query, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        const parsed = parseCompareQuery(query as Record<string, unknown>);

        if (!parsed.baseSnapshotId || !parsed.targetSnapshotId) {
          throw new ManagedSubscriptionError("baseSnapshotId 和 targetSnapshotId 不能为空。", 400);
        }

        return managedSubscriptionService.compareSnapshots(
          user.id,
          params.id,
          parsed.baseSnapshotId,
          parsed.targetSnapshotId
        );
      } catch (error) {
        return sendSubscriptionError(error, set);
      }
    })
    .patch("/:id", ({ headers, params, body, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        return managedSubscriptionService.update(user.id, params.id, parseSubscriptionBody(body));
      } catch (error) {
        return sendSubscriptionError(error, set);
      }
    })
    .delete("/:id", ({ headers, params, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        return managedSubscriptionService.delete(user.id, params.id);
      } catch (error) {
        return sendSubscriptionError(error, set);
      }
    })
    .post("/:id/render", async ({ headers, params, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        return await managedSubscriptionService.render(user.id, params.id);
      } catch (error) {
        return sendSubscriptionError(error, set);
      }
    })
    .post("/:id/secret/rotate", ({ headers, params, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        const result = managedSubscriptionService.rotateSecret(user.id, params.id);
        auditLogService.record({
          actorUserId: user.id,
          entityType: "user_subscription_secret",
          entityId: user.id,
          action: "subscription_secret.rotate",
          summary: `通过生成订阅 ${params.id} 入口轮换长期秘钥。`
        });
        return result;
      } catch (error) {
        return sendSubscriptionError(error, set);
      }
    })
    .post("/:id/temp-token", ({ headers, params, body, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        const expiresInSeconds = isRecord(body)
          ? optionalNumber(body, "expiresInSeconds")
          : undefined;

        const result = managedSubscriptionService.createTempToken(
          user.id,
          params.id,
          expiresInSeconds
        );
        auditLogService.record({
          actorUserId: user.id,
          entityType: "managed_subscription",
          entityId: params.id,
          action: "subscription.temp_token.create",
          summary: "创建临时订阅令牌。",
          after: {
            expiresAt: result.expiresAt
          }
        });
        return result;
      } catch (error) {
        return sendSubscriptionError(error, set);
      }
    });
};

const subscribePolicy = {
  keyPrefix: "subscribe:pull",
  limit: 120,
  windowMs: 60 * 1000
} as const;

export const createPublicSubscriptionRoutes = (
  managedSubscriptionService: ManagedSubscriptionService,
  rateLimiter: InMemoryRateLimiter
) => {
  return new Elysia()
    .get("/subscribe/:id", async ({ params, query, headers, request, set }) => {
      try {
        const rateLimitResult = rateLimiter.consume(resolveRateLimitSubject(request), subscribePolicy);
        applyRateLimitHeaders(set, rateLimitResult);

        if (!rateLimitResult.allowed) {
          throw new ManagedSubscriptionError("订阅拉取过于频繁，请稍后再试。", 429);
        }

        const token =
          typeof query.token === "string" ? query.token : "";
        const result = await managedSubscriptionService.deliver(
          params.id,
          token,
          request.headers.get("x-forwarded-for"),
          headers["user-agent"]
        );

        for (const [key, value] of Object.entries(result.headers)) {
          set.headers[key] = value;
        }
        set.headers["content-type"] = "text/yaml; charset=utf-8";

        logger.info({
          event: "subscription.pull.success",
          subscriptionId: params.id,
          status: result.status
        });
        return result.yamlText;
      } catch (error) {
        logger.warn({
          event: "subscription.pull.failed",
          subscriptionId: params.id,
          reason: error instanceof Error ? error.message : String(error)
        });
        return sendSubscriptionError(error, set);
      }
    });
};
