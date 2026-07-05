import { Elysia } from "elysia";

import { extractTemplate } from "../../lib/build-config/template";
import type { AuthService } from "../auth/auth.service";
import type { UserRecord } from "../users/user.repository";
import type { SubscriptionRepository } from "../subscriptions/subscription.repository";
import { SubscriptionError, SubscriptionService } from "../subscriptions/subscription.service";
import type { TemplateRepository } from "./template.repository";

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
  subscriptionService: SubscriptionService
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
      const result = extractTemplate(config);
      if ("error" in result) {
        set.status = 422;
        return { message: result.error };
      }
      return result;
    })

    // 确认保存模板
    .post("/", ({ body, currentUser, set }: Omit<Ctx, "params">) => {
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
      const result = extractTemplate(config);
      if ("error" in result) {
        set.status = 422;
        return { message: result.error };
      }
      const visibility = str(body, "visibility");
      const created = templateRepository.create({
        ownerUserId: currentUser.id,
        displayName: str(body, "displayName") ?? `${subscription.displayName} 的模板`,
        description: str(body, "description") ?? null,
        visibility:
          visibility === "public" || visibility === "unlisted" ? visibility : "private",
        payload: result.payload,
        extractionReport: result.report,
        versionNote: str(body, "versionNote") ?? null
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
          start: { kind: "template", templateId: params.id! }
        });
        set.status = 201;
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
      const updated = templateRepository.updateMeta(params.id!, currentUser.id, {
        displayName: str(body, "displayName"),
        description: str(body, "description"),
        visibility:
          visibility === "public" || visibility === "unlisted" || visibility === "private"
            ? visibility
            : undefined
      });
      if (!updated) {
        set.status = 404;
        return { message: "模板不存在或无权修改。" };
      }
      return templateRepository.findDetailVisibleTo(params.id!, currentUser.id);
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
