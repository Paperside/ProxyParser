import { Elysia } from "elysia";

import { extractTemplate } from "../../lib/build-config/template";
import type { AuthService } from "../auth/auth.service";
import type { UserRecord } from "../users/user.repository";
import type { SubscriptionRepository } from "../subscriptions/subscription.repository";
import { SubscriptionError, SubscriptionService } from "../subscriptions/subscription.service";
import type { TemplateRepository } from "./template.repository";
import type { SecretStore } from "../subscriptions/secret-store";
import type { AuditLogService } from "../audit/audit-log.service";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const str = (source: Record<string, unknown>, key: string) => {
  const value = source[key];
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

type Ctx = {
  currentUser: UserRecord;
  set: { status?: number | string };
  params: Record<string, string>;
  body: unknown;
};

export const createTemplateRoutes = (
  authService: AuthService,
  templateRepository: TemplateRepository,
  subscriptionRepository: SubscriptionRepository,
  subscriptionService: SubscriptionService,
  secretStore: SecretStore,
  auditLog: AuditLogService
) => {
  return new Elysia({ prefix: "/api/templates" })
    .derive(({ headers }) => ({
      currentUser: authService.authenticate(headers.authorization)
    }))
    .get("/", ({ currentUser }: Pick<Ctx, "currentUser">) =>
      templateRepository.listVisible(currentUser.id)
    )
    .get("/:id", ({ params, currentUser, set }: Omit<Ctx, "body">) => {
      const detail = templateRepository.findDetailVisibleTo(params.id!, currentUser.id);
      if (!detail) {
        set.status = 404;
        return { message: "模板不存在或无权访问。" };
      }
      return detail;
    })

    // 提炼预览：不落库，返回 payload + 报告（前端展示后再确认保存）
    .post("/extract-preview", ({ body, currentUser, set }: Omit<Ctx, "params">) => {
      if (!isRecord(body) || typeof body.subscriptionId !== "string") {
        set.status = 400;
        return { message: "缺少 subscriptionId。" };
      }
      const subscription = subscriptionRepository.findByIdAndOwner(
        body.subscriptionId,
        currentUser.id
      );
      const config = subscription?.draftBuildConfig ?? subscription?.buildConfig;
      if (!subscription || !config) {
        set.status = 404;
        return { message: "订阅不存在或尚无构建配置。" };
      }
      const retainSensitive = body.retainSensitive === true;
      const result = extractTemplate(config, { retainSensitive });
      if ("error" in result) {
        set.status = 422;
        return { message: result.error };
      }
      return { ...result, draftRevision: subscription.draftRevision, retainSensitive };
    })

    // 确认保存模板
    .post("/", ({ body, currentUser, set }: Omit<Ctx, "params">) => {
      if (
        !isRecord(body) ||
        typeof body.subscriptionId !== "string" ||
        typeof body.expectedDraftRevision !== "number" ||
        !Number.isInteger(body.expectedDraftRevision) ||
        body.expectedDraftRevision < 0
      ) {
        set.status = 400;
        return { message: "缺少 subscriptionId 或有效的 expectedDraftRevision。" };
      }
      const subscription = subscriptionRepository.findByIdAndOwner(
        body.subscriptionId,
        currentUser.id
      );
      const config = subscription?.draftBuildConfig ?? subscription?.buildConfig;
      if (!subscription || !config) {
        set.status = 404;
        return { message: "订阅不存在或尚无构建配置。" };
      }
      if (subscription.draftRevision !== body.expectedDraftRevision) {
        set.status = 409;
        return { message: "草稿已在预览后变化。请重新分析后再保存模板。" };
      }
      const retainSensitive = body.retainSensitive === true;
      if (retainSensitive && body.confirmSensitive !== true) {
        set.status = 400;
        return { message: "保留敏感信息前必须明确确认其会随模板复制。" };
      }
      const result = extractTemplate(config, { retainSensitive });
      if ("error" in result) {
        set.status = 422;
        return { message: result.error };
      }
      const visibility = str(body, "visibility");
      const selectedVisibility =
        visibility === "public" || visibility === "unlisted" ? visibility : "private";
      if (retainSensitive && selectedVisibility !== "private" && body.confirmShareSensitive !== true) {
        set.status = 400;
        return { message: "公开或链接分享含凭据模板前，必须再次确认任何可访问者都能复制这些凭据。" };
      }
      const embeddedSecrets = new Map<string, Record<string, unknown>>();
      if (retainSensitive) {
        for (const node of config.nodes.custom) {
          if (!node.secretRef) continue;
          const fields = secretStore.resolveForOwner(currentUser.id, node.secretRef);
          if (!fields) {
            set.status = 409;
            return { message: `自建节点「${node.name}」的敏感字段已失效，请重新保存节点后再提炼。` };
          }
          embeddedSecrets.set(node.id, fields);
        }
      }
      const created = templateRepository.create({
        ownerUserId: currentUser.id,
        displayName: str(body, "displayName") ?? `${subscription.displayName} 的模板`,
        description: str(body, "description") ?? null,
        visibility: selectedVisibility,
        payload: result.payload,
        extractionReport: result.report,
        versionNote: str(body, "versionNote") ?? null,
        embeddedSecrets
      });
      auditLog.record({
        actorUserId: currentUser.id,
        entityType: "template",
        entityId: created.id,
        action: "template.created",
        summary: retainSensitive ? "创建含加密敏感信息的模板" : "创建不含敏感信息的模板",
        after: { retainSensitive, visibility: selectedVisibility, secretNodeCount: embeddedSecrets.size }
      });
      set.status = 201;
      return created;
    })

    // 应用模板 → 创建新订阅
    .post("/:id/instantiate", ({ params, body, currentUser, set }: Ctx) => {
      try {
        if (!isRecord(body)) {
          set.status = 400;
          return { message: "请求体格式错误。" };
        }
        const sourceIds = Array.isArray(body.sourceIds)
          ? body.sourceIds.filter((id): id is string => typeof id === "string")
          : [];
        const created = subscriptionService.create(currentUser.id, {
          displayName: str(body, "displayName") ?? "",
          sourceIds,
          start: {
            kind: "template",
            templateId: params.id!,
            confirmSensitive: body.confirmSensitive === true
          }
        });
        set.status = 201;
        auditLog.record({
          actorUserId: currentUser.id,
          entityType: "template",
          entityId: params.id!,
          action: "template.instantiated",
          summary: "应用模板创建订阅",
          after: { subscriptionId: created.subscription.id }
        });
        return created;
      } catch (error) {
        if (error instanceof SubscriptionError) {
          set.status = error.status;
          return { message: error.message };
        }
        throw error;
      }
    })
    .patch("/:id", ({ params, body, currentUser, set }: Ctx) => {
      if (!isRecord(body)) {
        set.status = 400;
        return { message: "请求体格式错误。" };
      }
      const visibility = str(body, "visibility");
      const existing = templateRepository.findDetailVisibleTo(params.id!, currentUser.id);
      const requestedVisibility =
        visibility === "public" || visibility === "unlisted" || visibility === "private"
          ? visibility
          : undefined;
      if (
        existing?.ownerUserId === currentUser.id &&
        existing.embeddedSecrets &&
        requestedVisibility !== undefined &&
        requestedVisibility !== "private" &&
        body.confirmShareSensitive !== true
      ) {
        set.status = 400;
        return { message: "共享含凭据模板前，必须确认任何可访问者都能复制这些凭据。" };
      }
      const updated = templateRepository.updateMeta(params.id!, currentUser.id, {
        displayName: str(body, "displayName"),
        description: str(body, "description"),
        visibility: requestedVisibility
      });
      if (!updated) {
        set.status = 404;
        return { message: "模板不存在或无权修改。" };
      }
      const detail = templateRepository.findDetailVisibleTo(params.id!, currentUser.id);
      if (requestedVisibility && requestedVisibility !== existing?.visibility) {
        auditLog.record({
          actorUserId: currentUser.id,
          entityType: "template",
          entityId: params.id!,
          action: "template.visibility_changed",
          summary: "修改模板可见范围",
          before: { visibility: existing?.visibility ?? null },
          after: { visibility: requestedVisibility, embeddedSecrets: detail?.embeddedSecrets ?? false }
        });
      }
      return detail;
    })
    .delete("/:id", ({ params, currentUser, set }: Omit<Ctx, "body">) => {
      const deleted = templateRepository.deleteOwned(params.id!, currentUser.id);
      if (!deleted) {
        set.status = 404;
        return { message: "模板不存在、无权删除或为官方模板。" };
      }
      return { ok: true };
    });
};
