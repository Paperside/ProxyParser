import { Elysia } from "elysia";

import type { AuthService } from "../auth/auth.service";
import type { UserRecord } from "../users/user.repository";
import { UpstreamSourceError, UpstreamSourceService } from "./upstream-source.service";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const optionalString = (source: Record<string, unknown>, key: string) => {
  const value = source[key];
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const optionalNumber = (source: Record<string, unknown>, key: string) => {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const optionalBoolean = (source: Record<string, unknown>, key: string) => {
  const value = source[key];
  return typeof value === "boolean" ? value : undefined;
};

const sendError = (error: unknown, set: { status?: number | string }) => {
  if (error instanceof UpstreamSourceError) {
    set.status = error.status;
    return { message: error.message };
  }
  throw error;
};

type Ctx = {
  currentUser: UserRecord;
  set: { status?: number | string };
  params: { id: string };
  body: unknown;
};

export const createUpstreamSourceRoutes = (
  authService: AuthService,
  sourceService: UpstreamSourceService
) => {
  return new Elysia({ prefix: "/api/sources" })
    .derive(({ headers }) => ({
      currentUser: authService.authenticate(headers.authorization)
    }))
    .get("/", ({ currentUser }: Pick<Ctx, "currentUser">) => {
      return sourceService.listByOwner(currentUser.id);
    })
    .post("/", async ({ body, currentUser, set }: Omit<Ctx, "params">) => {
      try {
        if (!isRecord(body)) throw new UpstreamSourceError("请求体格式错误。");
        const yamlContent = optionalString(body, "yamlContent");
        const created = yamlContent
          ? sourceService.createFromUpload(currentUser.id, {
              displayName: optionalString(body, "displayName") ?? "",
              yamlContent,
              uploadedFileName: optionalString(body, "uploadedFileName")
            })
          : await sourceService.create(currentUser.id, {
              displayName: optionalString(body, "displayName") ?? "",
              sourceUrl: optionalString(body, "sourceUrl") ?? "",
              syncIntervalMinutes: optionalNumber(body, "syncIntervalMinutes")
            });
        set.status = 201;
        return created;
      } catch (error) {
        return sendError(error, set);
      }
    })
    .get("/:id", ({ params, currentUser, set }: Omit<Ctx, "body">) => {
      try {
        return sourceService.getById(currentUser.id, params.id);
      } catch (error) {
        return sendError(error, set);
      }
    })
    .get("/:id/sync-reports", ({ params, currentUser, set }: Omit<Ctx, "body">) => {
      try {
        return sourceService.listSyncReports(currentUser.id, params.id);
      } catch (error) {
        return sendError(error, set);
      }
    })
    .patch("/:id", ({ params, body, currentUser, set }: Ctx) => {
      try {
        if (!isRecord(body)) throw new UpstreamSourceError("请求体格式错误。");
        const yamlContent = optionalString(body, "yamlContent");
        if (yamlContent) {
          return sourceService.replaceUpload(currentUser.id, params.id, yamlContent);
        }
        return sourceService.update(currentUser.id, params.id, {
          displayName: optionalString(body, "displayName"),
          sourceUrl: optionalString(body, "sourceUrl"),
          isEnabled: optionalBoolean(body, "isEnabled"),
          syncIntervalMinutes: optionalNumber(body, "syncIntervalMinutes")
        });
      } catch (error) {
        return sendError(error, set);
      }
    })
    .post("/:id/sync", async ({ params, currentUser, set }: Omit<Ctx, "body">) => {
      try {
        return await sourceService.syncByOwner(currentUser.id, params.id);
      } catch (error) {
        return sendError(error, set);
      }
    })
    .delete("/:id", ({ params, currentUser, set }: Omit<Ctx, "body">) => {
      try {
        return sourceService.delete(currentUser.id, params.id);
      } catch (error) {
        return sendError(error, set);
      }
    });
};
