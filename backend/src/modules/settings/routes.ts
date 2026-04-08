import { Elysia } from "elysia";

import type { AuditLogService } from "../audit/audit-log.service";
import { AuthError, type AuthService } from "../auth/auth.service";
import { SettingsError, SettingsService } from "./settings.service";

const sendSettingsError = (
  error: unknown,
  set: { status?: number | string }
) => {
  if (error instanceof AuthError) {
    set.status = error.status;
    return {
      message: error.message
    };
  }

  if (error instanceof SettingsError) {
    set.status = error.status;
    return {
      message: error.message
    };
  }

  throw error;
};

export const createSettingsRoutes = (
  authService: AuthService,
  settingsService: SettingsService,
  auditLogService: AuditLogService
) => {
  return new Elysia({ prefix: "/api/settings" })
    .get("/audit-logs", ({ headers, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        return auditLogService.listForActor(user.id, 20);
      } catch (error) {
        return sendSettingsError(error, set);
      }
    })
    .post("/subscription-secret/rotate", ({ headers, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        const result = settingsService.rotateSubscriptionSecret(user.id);
        auditLogService.record({
          actorUserId: user.id,
          entityType: "user_subscription_secret",
          entityId: user.id,
          action: "subscription_secret.rotate",
          summary: "重新生成长期订阅秘钥。"
        });
        return result;
      } catch (error) {
        return sendSettingsError(error, set);
      }
    });
};
