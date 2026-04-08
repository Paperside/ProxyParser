import { Elysia } from "elysia";

import type { AuthService } from "../auth/auth.service";
import { TemplateError, TemplateService } from "./template.service";

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

const parseTemplateBody = (body: unknown) => {
  if (!isRecord(body)) {
    throw new TemplateError("请求体格式错误。", 400);
  }

  return {
    displayName: optionalString(body, "displayName") ?? "",
    slug: optionalString(body, "slug"),
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
      | undefined,
    versionNote: optionalString(body, "versionNote"),
    payload: body.payload
  };
};

const sendTemplateError = (
  error: unknown,
  set: { status?: number | string }
) => {
  if (error instanceof TemplateError) {
    set.status = error.status;
    return {
      message: error.message
    };
  }

  throw error;
};

export const createTemplateRoutes = (
  authService: AuthService,
  templateService: TemplateService
) => {
  return new Elysia({ prefix: "/api/templates" })
    .get("/", ({ headers, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        return templateService.listByOwner(user.id);
      } catch (error) {
        return sendTemplateError(error, set);
      }
    })
    .post("/", ({ headers, body, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        const created = templateService.create(user.id, parseTemplateBody(body));
        set.status = 201;
        return created;
      } catch (error) {
        return sendTemplateError(error, set);
      }
    })
    .post("/:id/fork", ({ headers, params, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        const created = templateService.forkPublicTemplate(user.id, params.id);
        set.status = 201;
        return created;
      } catch (error) {
        return sendTemplateError(error, set);
      }
    })
    .get("/:id", ({ headers, params, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        return templateService.getById(user.id, params.id);
      } catch (error) {
        return sendTemplateError(error, set);
      }
    })
    .patch("/:id", ({ headers, params, body, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        return templateService.update(user.id, params.id, parseTemplateBody(body));
      } catch (error) {
        return sendTemplateError(error, set);
      }
    })
    .delete("/:id", ({ headers, params, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        return templateService.delete(user.id, params.id);
      } catch (error) {
        return sendTemplateError(error, set);
      }
    });
};
