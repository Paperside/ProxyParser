import { Elysia } from "elysia";

import type { AuditLogService } from "../audit/audit-log.service";
import { AuthError, type AuthService } from "../auth/auth.service";
import {
  ManagedSubscriptionError,
  ManagedSubscriptionService
} from "../subscriptions/managed-subscription.service";
import {
  GeneratedSubscriptionDraftError,
  GeneratedSubscriptionDraftService
} from "./generated-subscription-draft.service";

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

const parseCreateBody = (body: unknown) => {
  if (!isRecord(body)) {
    throw new GeneratedSubscriptionDraftError("请求体格式错误。", 400);
  }

  return {
    displayName: optionalString(body, "displayName") ?? "",
    upstreamSourceId: optionalString(body, "upstreamSourceId")
  };
};

const parseUpdateBody = (body: unknown) => {
  if (!isRecord(body)) {
    throw new GeneratedSubscriptionDraftError("请求体格式错误。", 400);
  }

  return {
    displayName: optionalString(body, "displayName"),
    upstreamSourceId: optionalString(body, "upstreamSourceId"),
    currentStep: optionalString(body, "currentStep") as
      | "source"
      | "proxies"
      | "groups_rules"
      | "settings"
      | "preview"
      | undefined,
    shareabilityStatus: optionalString(body, "shareabilityStatus") as
      | "unknown"
      | "shareable"
      | "source_locked"
      | undefined,
    selectedSourceSnapshotId: optionalString(body, "selectedSourceSnapshotId"),
    lastPreviewYaml: optionalString(body, "lastPreviewYaml")
  };
};

const parseStepBody = (body: unknown) => {
  if (!isRecord(body)) {
    throw new GeneratedSubscriptionDraftError("请求体格式错误。", 400);
  }

  const stepKey = optionalString(body, "stepKey") as
    | "source"
    | "proxies"
    | "groups_rules"
    | "settings"
    | undefined;

  if (!stepKey) {
    throw new GeneratedSubscriptionDraftError("stepKey 不能为空。", 400);
  }

  return {
    stepKey,
    patchMode: optionalString(body, "patchMode") as "patch" | "full_override" | undefined,
    editorMode: optionalString(body, "editorMode") as "visual" | "raw" | undefined,
    operations: body.operations,
    raw: body.raw,
    summary: isRecord(body.summary) ? body.summary : undefined,
    currentStep: optionalString(body, "currentStep") as
      | "source"
      | "proxies"
      | "groups_rules"
      | "settings"
      | "preview"
      | undefined,
    shareabilityStatus: optionalString(body, "shareabilityStatus") as
      | "unknown"
      | "shareable"
      | "source_locked"
      | undefined
  };
};

const parsePublishBody = (body: unknown) => {
  if (!isRecord(body)) {
    return {};
  }

  return {
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
    isEnabled: typeof body.isEnabled === "boolean" ? body.isEnabled : undefined
  };
};

const parseExtractTemplateBody = (body: unknown) => {
  if (!isRecord(body)) {
    return {};
  }

  return {
    displayName: optionalString(body, "displayName"),
    description: optionalString(body, "description"),
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
    publishStatus: optionalString(body, "publishStatus") as
      | "draft"
      | "published"
      | "archived"
      | undefined
  };
};

const sendDraftError = (
  error: unknown,
  set: { status?: number | string }
) => {
  if (error instanceof AuthError) {
    set.status = error.status;
    return {
      message: error.message
    };
  }

  if (error instanceof GeneratedSubscriptionDraftError) {
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

export const createGeneratedSubscriptionDraftRoutes = (
  authService: AuthService,
  draftService: GeneratedSubscriptionDraftService,
  managedSubscriptionService: ManagedSubscriptionService,
  auditLogService: AuditLogService
) => {
  return new Elysia({ prefix: "/api/generated-subscription-drafts" })
    .get("/", ({ headers, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        return draftService.listByOwner(user.id);
      } catch (error) {
        return sendDraftError(error, set);
      }
    })
    .post("/", ({ headers, body, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        const created = draftService.create(user.id, parseCreateBody(body));
        set.status = 201;
        return created;
      } catch (error) {
        return sendDraftError(error, set);
      }
    })
    .get("/:id", ({ headers, params, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        return draftService.getById(user.id, params.id);
      } catch (error) {
        return sendDraftError(error, set);
      }
    })
    .patch("/:id", ({ headers, params, body, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        return draftService.update(user.id, params.id, parseUpdateBody(body));
      } catch (error) {
        return sendDraftError(error, set);
      }
    })
    .post("/:id/steps", ({ headers, params, body, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        return draftService.saveStep(user.id, params.id, parseStepBody(body));
      } catch (error) {
        return sendDraftError(error, set);
      }
    })
    .post("/:id/preview", async ({ headers, params, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        return await draftService.preview(user.id, params.id);
      } catch (error) {
        return sendDraftError(error, set);
      }
    })
    .post("/:id/publish", async ({ headers, params, body, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        const created = await managedSubscriptionService.publishFromDraft(
          user.id,
          params.id,
          parsePublishBody(body)
        );
        auditLogService.record({
          actorUserId: user.id,
          entityType: "managed_subscription",
          entityId: created.id,
          action: "draft.publish",
          summary: `从草稿 ${params.id} 发布生成订阅。`,
          after: {
            renderMode: created.renderMode,
            visibility: created.visibility,
            shareMode: created.shareMode
          }
        });
        return created;
      } catch (error) {
        return sendDraftError(error, set);
      }
    })
    .post("/:id/extract-template", async ({ headers, params, body, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        const created = await draftService.extractTemplate(
          user.id,
          params.id,
          parseExtractTemplateBody(body)
        );
        auditLogService.record({
          actorUserId: user.id,
          entityType: "template",
          entityId: created.id,
          action: "draft.extract_template",
          summary: `从草稿 ${params.id} 提炼模板。`,
          after: {
            displayName: created.displayName,
            visibility: created.visibility,
            shareMode: created.shareMode
          }
        });
        set.status = 201;
        return created;
      } catch (error) {
        return sendDraftError(error, set);
      }
    });
};
