import { Elysia } from "elysia";

import type { AuthService } from "../auth/auth.service";
import type { UserRecord } from "../users/user.repository";
import type { SecretStore } from "./secret-store";
import { SubscriptionError, SubscriptionService, type StartKind } from "./subscription.service";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const str = (source: Record<string, unknown>, key: string) => {
  const value = source[key];
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const sendError = (error: unknown, set: { status?: number | string }) => {
  if (error instanceof SubscriptionError) {
    set.status = error.status;
    return { message: error.message, issues: error.issues };
  }
  throw error;
};

type Ctx = {
  currentUser: UserRecord;
  set: { status?: number | string };
  params: Record<string, string>;
  body: unknown;
};

export const createSubscriptionRoutes = (
  authService: AuthService,
  service: SubscriptionService,
  secretStore: SecretStore
) => {
  return new Elysia({ prefix: "/api" })
    .derive(({ headers }) => ({
      currentUser: authService.authenticate(headers.authorization)
    }))

    // ── 订阅 CRUD ─────────────────────────────────────────────
    .get("/subscriptions", ({ currentUser }: Pick<Ctx, "currentUser">) =>
      service.listByOwner(currentUser.id)
    )
    .post("/subscriptions", ({ body, currentUser, set }: Omit<Ctx, "params">) => {
      try {
        if (!isRecord(body)) throw new SubscriptionError("请求体格式错误。");
        const sourceIds = Array.isArray(body.sourceIds)
          ? body.sourceIds.filter((id): id is string => typeof id === "string")
          : [];
        const startRaw = isRecord(body.start) ? body.start : {};
        const kind = (str(startRaw, "kind") ?? "recommended") as StartKind;
        const created = service.create(currentUser.id, {
          displayName: str(body, "displayName") ?? "",
          sourceIds,
          start: { kind, templateId: str(startRaw, "templateId") }
        });
        set.status = 201;
        return created;
      } catch (error) {
        return sendError(error, set);
      }
    })
    .get("/subscriptions/:id", ({ params, currentUser, set }: Omit<Ctx, "body">) => {
      try {
        return service.getDetail(currentUser.id, params.id!);
      } catch (error) {
        return sendError(error, set);
      }
    })
    .patch("/subscriptions/:id", ({ params, body, currentUser, set }: Ctx) => {
      try {
        if (!isRecord(body)) throw new SubscriptionError("请求体格式错误。");
        return service.updateMeta(currentUser.id, params.id!, {
          displayName: str(body, "displayName"),
          isEnabled: typeof body.isEnabled === "boolean" ? body.isEnabled : undefined,
          publishPolicy:
            body.publishPolicy === "auto" || body.publishPolicy === "confirm"
              ? body.publishPolicy
              : undefined
        });
      } catch (error) {
        return sendError(error, set);
      }
    })
    .delete("/subscriptions/:id", ({ params, currentUser, set }: Omit<Ctx, "body">) => {
      try {
        return service.delete(currentUser.id, params.id!);
      } catch (error) {
        return sendError(error, set);
      }
    })

    // ── 草稿 / 预览 / 发布 ─────────────────────────────────────
    .put("/subscriptions/:id/draft", ({ params, body, currentUser, set }: Ctx) => {
      try {
        return service.saveDraft(currentUser.id, params.id!, body);
      } catch (error) {
        return sendError(error, set);
      }
    })
    .delete("/subscriptions/:id/draft", ({ params, currentUser, set }: Omit<Ctx, "body">) => {
      try {
        return service.discardDraft(currentUser.id, params.id!);
      } catch (error) {
        return sendError(error, set);
      }
    })
    .post("/subscriptions/:id/preview", ({ params, currentUser, set }: Omit<Ctx, "body">) => {
      try {
        return service.preview(currentUser.id, params.id!);
      } catch (error) {
        return sendError(error, set);
      }
    })
    .post("/subscriptions/:id/publish", ({ params, currentUser, set }: Omit<Ctx, "body">) => {
      try {
        const release = service.publish(currentUser.id, params.id!, { trigger: "manual" });
        return {
          id: release.id,
          seq: release.seq,
          diffSummary: release.diffSummary,
          validation: release.validation,
          createdAt: release.createdAt
        };
      } catch (error) {
        return sendError(error, set);
      }
    })
    .post("/subscriptions/:id/rollback", ({ params, body, currentUser, set }: Ctx) => {
      try {
        if (!isRecord(body) || typeof body.releaseId !== "string") {
          throw new SubscriptionError("缺少 releaseId。");
        }
        const release = service.rollback(currentUser.id, params.id!, body.releaseId);
        return { id: release.id, seq: release.seq, createdAt: release.createdAt };
      } catch (error) {
        return sendError(error, set);
      }
    })

    // ── 版本 ──────────────────────────────────────────────────
    .get("/subscriptions/:id/releases", ({ params, currentUser, set }: Omit<Ctx, "body">) => {
      try {
        return service.listReleases(currentUser.id, params.id!);
      } catch (error) {
        return sendError(error, set);
      }
    })
    .get(
      "/subscriptions/:id/releases/:releaseId",
      ({ params, currentUser, set }: Omit<Ctx, "body">) => {
        try {
          const release = service.getRelease(currentUser.id, params.id!, params.releaseId!);
          return {
            id: release.id,
            seq: release.seq,
            trigger: release.trigger,
            triggerDetail: release.triggerDetail,
            diffSummary: release.diffSummary,
            validation: release.validation,
            renderedYaml: release.renderedYaml,
            createdBy: release.createdBy,
            createdAt: release.createdAt
          };
        } catch (error) {
          return sendError(error, set);
        }
      }
    )

    // ── 规则追踪 ───────────────────────────────────────────────
    .post("/subscriptions/:id/trace", ({ params, body, currentUser, set }: Ctx) => {
      try {
        if (!isRecord(body) || typeof body.query !== "string" || body.query.trim().length === 0) {
          throw new SubscriptionError("缺少 query。");
        }
        return service.trace(currentUser.id, params.id!, body.query, body.draft !== false);
      } catch (error) {
        return sendError(error, set);
      }
    })

    // ── 问题 ──────────────────────────────────────────────────
    .get("/subscriptions/:id/issues", ({ params, currentUser, set }: Omit<Ctx, "body">) => {
      try {
        service.getDetail(currentUser.id, params.id!);
        return service.listByOwner(currentUser.id).length >= 0
          ? service.getDetail(currentUser.id, params.id!).issues
          : [];
      } catch (error) {
        return sendError(error, set);
      }
    })

    // ── 访问与 Token ───────────────────────────────────────────
    .get("/subscriptions/:id/access", ({ params, currentUser, set }: Omit<Ctx, "body">) => {
      try {
        return service.listAccess(currentUser.id, params.id!);
      } catch (error) {
        return sendError(error, set);
      }
    })
    .post("/subscriptions/:id/tokens", ({ params, body, currentUser, set }: Ctx) => {
      try {
        const label = isRecord(body) ? (str(body, "label") ?? null) : null;
        return service.createToken(currentUser.id, params.id!, label);
      } catch (error) {
        return sendError(error, set);
      }
    })
    .post(
      "/subscriptions/:id/tokens/:tokenId/rotate",
      ({ params, currentUser, set }: Omit<Ctx, "body">) => {
        try {
          return service.rotateToken(currentUser.id, params.id!, params.tokenId!);
        } catch (error) {
          return sendError(error, set);
        }
      }
    )
    .delete(
      "/subscriptions/:id/tokens/:tokenId",
      ({ params, currentUser, set }: Omit<Ctx, "body">) => {
        try {
          return service.revokeToken(currentUser.id, params.id!, params.tokenId!);
        } catch (error) {
          return sendError(error, set);
        }
      }
    )
    .post("/subscriptions/:id/temp-tokens", ({ params, body, currentUser, set }: Ctx) => {
      try {
        const record = isRecord(body) ? body : {};
        const ttlSeconds =
          typeof record.ttlSeconds === "number" ? record.ttlSeconds : 24 * 3600;
        return service.createTempToken(currentUser.id, params.id!, {
          label: str(record, "label") ?? null,
          ttlSeconds
        });
      } catch (error) {
        return sendError(error, set);
      }
    })
    .delete(
      "/subscriptions/:id/temp-tokens/:tokenId",
      ({ params, currentUser, set }: Omit<Ctx, "body">) => {
        try {
          return service.revokeTempToken(currentUser.id, params.id!, params.tokenId!);
        } catch (error) {
          return sendError(error, set);
        }
      }
    )

    // ── 自建节点敏感字段 ────────────────────────────────────────
    .post("/secrets", ({ body, currentUser, set }: Omit<Ctx, "params">) => {
      try {
        if (!isRecord(body) || !isRecord(body.fields)) {
          throw new SubscriptionError("缺少 fields 对象。");
        }
        const secretRef = secretStore.create(currentUser.id, body.fields);
        set.status = 201;
        return { secretRef, fieldNames: Object.keys(body.fields) };
      } catch (error) {
        return sendError(error, set);
      }
    })
    .put("/secrets/:id", ({ params, body, currentUser, set }: Ctx) => {
      try {
        if (!isRecord(body) || !isRecord(body.fields)) {
          throw new SubscriptionError("缺少 fields 对象。");
        }
        const updated = secretStore.update(currentUser.id, params.id!, body.fields);
        if (!updated) {
          throw new SubscriptionError("敏感字段记录不存在。", 404);
        }
        return { secretRef: params.id, fieldNames: Object.keys(body.fields) };
      } catch (error) {
        return sendError(error, set);
      }
    })

    // ── 规则源更新应用 ──────────────────────────────────────────
    .post("/rulesets/apply-update", ({ body, currentUser, set }: Omit<Ctx, "params">) => {
      try {
        if (
          !isRecord(body) ||
          typeof body.catalogId !== "string" ||
          typeof body.toHash !== "string" ||
          !Array.isArray(body.subscriptionIds)
        ) {
          throw new SubscriptionError("需要 catalogId、toHash 与 subscriptionIds。");
        }
        return service.applyRulesetUpdate(currentUser.id, {
          catalogId: body.catalogId,
          toHash: body.toHash,
          subscriptionIds: body.subscriptionIds.filter(
            (id): id is string => typeof id === "string"
          )
        });
      } catch (error) {
        return sendError(error, set);
      }
    })
    .get(
      "/rulesets/:id/referencing-subscriptions",
      ({ params, currentUser }: Omit<Ctx, "body">) => {
        return service.listReferencingRuleset(currentUser.id, params.id!);
      }
    );
};
