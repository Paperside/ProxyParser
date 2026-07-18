import { Elysia } from "elysia";

import type { AuthService } from "../auth/auth.service";
import type { UserRecord } from "../users/user.repository";
import type { SecretStore } from "./secret-store";
import { applyRateLimitHeaders, type InMemoryRateLimiter } from "../../lib/security/rate-limiter";
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
  set: {
    status?: number | string;
    headers?: Record<string, string | number | string[] | undefined>;
  };
  params: Record<string, string>;
  body: unknown;
  request: Request;
};

const preventBearerCaching = (set: Ctx["set"]) => {
  set.headers = {
    ...(set.headers ?? {}),
    "Cache-Control": "no-store",
    Pragma: "no-cache"
  };
};

export const createSubscriptionRoutes = (
  authService: AuthService,
  service: SubscriptionService,
  secretStore: SecretStore,
  rateLimiter: InMemoryRateLimiter
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
          start: {
            kind,
            templateId: str(startRaw, "templateId"),
            confirmSensitive: startRaw.confirmSensitive === true,
            regionScope:
              startRaw.regionScope === "common" || startRaw.regionScope === "full"
                ? startRaw.regionScope
                : undefined
          }
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
        if (!isRecord(body) || !("buildConfig" in body)) {
          throw new SubscriptionError(
            "草稿保存请求缺少并发版本；请刷新控制台后重试。",
            422
          );
        }
        if (
          typeof body.expectedDraftRevision !== "number" ||
          !Number.isInteger(body.expectedDraftRevision) ||
          body.expectedDraftRevision < 0
        ) {
          throw new SubscriptionError("缺少有效的 expectedDraftRevision。", 422);
        }
        return service.saveDraft(
          currentUser.id,
          params.id!,
          body.buildConfig,
          body.expectedDraftRevision
        );
      } catch (error) {
        return sendError(error, set);
      }
    })
    .delete("/subscriptions/:id/draft", ({ params, body, currentUser, set }: Ctx) => {
      try {
        if (
          !isRecord(body) ||
          typeof body.expectedDraftRevision !== "number" ||
          !Number.isInteger(body.expectedDraftRevision) ||
          body.expectedDraftRevision < 0
        ) {
          throw new SubscriptionError("缺少有效的 expectedDraftRevision。", 422);
        }
        return service.discardDraft(
          currentUser.id,
          params.id!,
          body.expectedDraftRevision
        );
      } catch (error) {
        return sendError(error, set);
      }
    })
    .post(
      "/subscriptions/:id/workspace-index",
      ({ params, currentUser, set }: Omit<Ctx, "body">) => {
        try {
          return service.workspaceIndex(currentUser.id, params.id!);
        } catch (error) {
          return sendError(error, set);
        }
      }
    )
    .post("/subscriptions/:id/preview", ({ params, currentUser, set }: Omit<Ctx, "body">) => {
      try {
        return service.preview(currentUser.id, params.id!);
      } catch (error) {
        return sendError(error, set);
      }
    })
    .post(
      "/subscriptions/:id/preview/yaml",
      ({ params, currentUser, set }: Omit<Ctx, "body">) => {
        try {
          const result = service.previewYaml(currentUser.id, params.id!);
          set.headers = {
            ...set.headers,
            "Content-Type": "application/yaml; charset=utf-8",
            "Content-Length": String(Buffer.byteLength(result.yamlText, "utf8")),
            "Cache-Control": "no-store",
            "Access-Control-Expose-Headers":
              "X-Draft-Revision, X-Rendered-Hash, ETag, Content-Length",
            "X-Draft-Revision": String(result.draftRevision),
            "X-Rendered-Hash": result.renderedHash,
            ETag: `"${result.renderedHash}"`
          };
          return result.yamlText;
        } catch (error) {
          return sendError(error, set);
        }
      }
    )
    .post(
      "/subscriptions/:id/publish-candidates",
      ({ params, currentUser, set }: Omit<Ctx, "body">) => {
        try {
          const limit = rateLimiter.consume(currentUser.id, {
            keyPrefix: "publish-candidate",
            limit: 6,
            windowMs: 60_000
          });
          applyRateLimitHeaders(set, limit);
          if (!limit.allowed) {
            throw new SubscriptionError("发布候选生成过于频繁，请稍后再试。", 429);
          }
          return service.preparePublishCandidate(currentUser.id, params.id!);
        } catch (error) {
          return sendError(error, set);
        }
      }
    )
    .post(
      "/subscriptions/:id/publish-candidates/:candidateId/validate",
      async ({ params, currentUser, set }: Omit<Ctx, "body">) => {
        try {
          return await service.validatePublishCandidate(
            currentUser.id,
            params.id!,
            params.candidateId!
          );
        } catch (error) {
          return sendError(error, set);
        }
      }
    )
    .post("/subscriptions/:id/latency-tests", async ({ params, body, currentUser, set, request }: Ctx) => {
      try {
        const limit = rateLimiter.consume(currentUser.id, {
          keyPrefix: "latency-test",
          limit: 10,
          windowMs: 60_000
        });
        applyRateLimitHeaders(set, limit);
        if (!limit.allowed) throw new SubscriptionError("延迟测试过于频繁，请稍后再试。", 429);
        const nodeIds = isRecord(body) ? body.nodeIds : null;
        if (
          !Array.isArray(nodeIds) ||
          nodeIds.length === 0 ||
          nodeIds.length > 200 ||
          nodeIds.some((value) => typeof value !== "string" || value.trim().length === 0)
        ) {
          throw new SubscriptionError("nodeIds 必须包含 1 至 200 个有效节点 ID。", 422);
        }
        return await service.testLatency(
          currentUser.id,
          params.id!,
          nodeIds as string[],
          request.signal
        );
      } catch (error) {
        return sendError(error, set);
      }
    })
    .post("/subscriptions/:id/publish", ({ params, body, currentUser, set }: Ctx) => {
      try {
        if (isRecord(body) && !("candidateId" in body)) {
          throw new SubscriptionError(
            "发布流程已升级，请刷新页面后重新预览并发布。",
            409
          );
        }
        if (
          !isRecord(body) ||
          typeof body.candidateId !== "string" ||
          body.candidateId.length === 0 ||
          typeof body.expectedDraftRevision !== "number" ||
          !Number.isInteger(body.expectedDraftRevision) ||
          body.expectedDraftRevision < 0 ||
          typeof body.expectedRenderedHash !== "string" ||
          !/^[a-f0-9]{64}$/.test(body.expectedRenderedHash)
        ) {
          throw new SubscriptionError(
            "缺少有效的 candidateId、expectedDraftRevision 或 expectedRenderedHash。",
            422
          );
        }
        const release = service.publishPreparedCandidate(currentUser.id, params.id!, {
          candidateId: body.candidateId,
          expectedDraftRevision: body.expectedDraftRevision,
          expectedRenderedHash: body.expectedRenderedHash
        });
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
        if (
          !isRecord(body) ||
          typeof body.releaseId !== "string" ||
          typeof body.expectedDraftRevision !== "number" ||
          !Number.isInteger(body.expectedDraftRevision) ||
          body.expectedDraftRevision < 0
        ) {
          throw new SubscriptionError("缺少 releaseId 或有效的 expectedDraftRevision。", 422);
        }
        const release = service.rollback(
          currentUser.id,
          params.id!,
          body.releaseId,
          body.expectedDraftRevision
        );
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
      "/subscriptions/:id/releases/:releaseId/yaml",
      ({ params, currentUser, set }: Omit<Ctx, "body">) => {
        try {
          const release = service.getRelease(currentUser.id, params.id!, params.releaseId!);
          set.headers = {
            ...set.headers,
            "Content-Type": "application/yaml; charset=utf-8",
            "Content-Length": String(Buffer.byteLength(release.renderedYaml, "utf8")),
            "Content-Disposition": `attachment; filename="subscription-v${release.seq}.yaml"`,
            "Cache-Control": "no-store",
            "Access-Control-Expose-Headers":
              "X-Rendered-Hash, X-Yaml-Bytes, ETag, Content-Length, Content-Disposition",
            "X-Rendered-Hash": release.renderedHash,
            "X-Yaml-Bytes": String(Buffer.byteLength(release.renderedYaml, "utf8")),
            ETag: `"${release.renderedHash}"`
          };
          return release.renderedYaml;
        } catch (error) {
          return sendError(error, set);
        }
      }
    )
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
            yamlBytes: Buffer.byteLength(release.renderedYaml, "utf8"),
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

    // ── 当前订阅规则快照同步 ────────────────────────────────────
    .post(
      "/subscriptions/:id/rulesets/sync-latest",
      ({ params, body, currentUser, set }: Ctx) => {
        try {
          if (
            !isRecord(body) ||
            typeof body.expectedDraftRevision !== "number" ||
            !Number.isInteger(body.expectedDraftRevision) ||
            body.expectedDraftRevision < 0
          ) {
            throw new SubscriptionError("缺少有效的 expectedDraftRevision。", 422);
          }
          return service.syncRulesetsToLatest(
            currentUser.id,
            params.id!,
            body.expectedDraftRevision
          );
        } catch (error) {
          return sendError(error, set);
        }
      }
    )

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
    // 工作台卡片 / 订阅列表「复制链接」快捷按钮：只读取已有长期链接，不隐式签发 token。
    .get(
      "/subscriptions/:id/primary-link",
      ({ params, currentUser, set }: Omit<Ctx, "body">) => {
        preventBearerCaching(set);
        try {
          return service.getPrimaryLink(currentUser.id, params.id!);
        } catch (error) {
          return sendError(error, set);
        }
      }
    )
    .post("/subscriptions/:id/tokens", ({ params, body, currentUser, set }: Ctx) => {
      preventBearerCaching(set);
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
        preventBearerCaching(set);
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
    .patch("/subscriptions/:id/tokens/:tokenId", ({ params, body, currentUser, set }: Ctx) => {
      try {
        const label = isRecord(body) ? (str(body, "label") ?? null) : null;
        return service.renameToken(currentUser.id, params.id!, params.tokenId!, label);
      } catch (error) {
        return sendError(error, set);
      }
    })
    .get(
      "/subscriptions/:id/tokens/:tokenId/reveal",
      ({ params, currentUser, set }: Omit<Ctx, "body">) => {
        preventBearerCaching(set);
        try {
          return service.revealToken(currentUser.id, params.id!, params.tokenId!);
        } catch (error) {
          return sendError(error, set);
        }
      }
    )
    .get(
      "/subscriptions/:id/temp-tokens/:tokenId/reveal",
      ({ params, currentUser, set }: Omit<Ctx, "body">) => {
        preventBearerCaching(set);
        try {
          return service.revealTempToken(currentUser.id, params.id!, params.tokenId!);
        } catch (error) {
          return sendError(error, set);
        }
      }
    )
    .post("/subscriptions/:id/temp-tokens", ({ params, body, currentUser, set }: Ctx) => {
      preventBearerCaching(set);
      try {
        const record = isRecord(body) ? body : {};
        const ttlSeconds =
          typeof record.ttlSeconds === "number" ? record.ttlSeconds : undefined;
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

    // ── 自建节点字段拆分（用户只填一张表单，敏感/非敏感由后端按协议 schema 拆分）──
    .post("/secrets/split", ({ body, currentUser, set }: Omit<Ctx, "params">) => {
      preventBearerCaching(set);
      try {
        if (!isRecord(body) || typeof body.type !== "string" || !isRecord(body.fields)) {
          throw new SubscriptionError("缺少 type 或 fields 对象。");
        }
        const existingSecretRef =
          typeof body.secretRef === "string" && body.secretRef.length > 0 ? body.secretRef : null;
        const result = secretStore.upsertSplit(currentUser.id, body.type, body.fields, existingSecretRef);
        set.status = 201;
        return result;
      } catch (error) {
        return sendError(error, set);
      }
    })
    // 仅用于打开编辑弹窗时回显：解密后的敏感字段（owner 校验）
    .get("/secrets/:id", ({ params, currentUser, set }: Omit<Ctx, "body">) => {
      preventBearerCaching(set);
      try {
        const fields = secretStore.resolveForOwner(currentUser.id, params.id!);
        if (!fields) {
          throw new SubscriptionError("敏感字段记录不存在。", 404);
        }
        return { fields };
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
          !Array.isArray(body.subscriptions)
        ) {
          throw new SubscriptionError("需要 catalogId、toHash 与 subscriptions。");
        }
        const subscriptions = body.subscriptions.map((value) => {
          if (
            !isRecord(value) ||
            typeof value.id !== "string" ||
            typeof value.expectedDraftRevision !== "number" ||
            !Number.isInteger(value.expectedDraftRevision) ||
            value.expectedDraftRevision < 0
          ) {
            throw new SubscriptionError("subscriptions 包含无效的订阅或草稿版本。", 422);
          }
          return { id: value.id, expectedDraftRevision: value.expectedDraftRevision };
        });
        if (new Set(subscriptions.map((item) => item.id)).size !== subscriptions.length) {
          throw new SubscriptionError("subscriptions 不得包含重复订阅。", 422);
        }
        return service.applyRulesetUpdate(currentUser.id, {
          catalogId: body.catalogId,
          toHash: body.toHash,
          subscriptions
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
