import { Elysia } from "elysia";

import type { UserRecord } from "../users/user.repository";
import type { AuthService } from "../auth/auth.service";
import { UpstreamSourceError, UpstreamSourceService } from "./upstream-source.service";

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

const sendSourceError = (
  error: unknown,
  set: { status?: number | string }
) => {
  if (error instanceof UpstreamSourceError) {
    set.status = error.status;
    return {
      message: error.message
    };
  }

  throw error;
};

const requireUser = (authService: AuthService, authorizationHeader: string | undefined | null) => {
  return authService.authenticate(authorizationHeader);
};

const parseCreateBody = (body: unknown) => {
  if (!isRecord(body)) {
    throw new UpstreamSourceError("请求体格式错误。", 400);
  }

  return {
    displayName: optionalString(body, "displayName") ?? "",
    sourceUrl: optionalString(body, "sourceUrl") ?? "",
    visibility: optionalString(body, "visibility") as
      | "private"
      | "unlisted"
      | "public"
      | undefined,
    shareMode: optionalString(body, "shareMode") as
      | "disabled"
      | "view"
      | "fork"
      | undefined
  };
};

const parseUpdateBody = (body: unknown) => {
  if (!isRecord(body)) {
    throw new UpstreamSourceError("请求体格式错误。", 400);
  }

  return {
    displayName: optionalString(body, "displayName"),
    sourceUrl: optionalString(body, "sourceUrl"),
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

export const createUpstreamSourceRoutes = (
  authService: AuthService,
  upstreamSourceService: UpstreamSourceService
) => {
  return new Elysia({ prefix: "/api/upstream-sources" })
    .derive(({ headers }) => {
      const user = requireUser(authService, headers.authorization);

      return {
        currentUser: user
      };
    })
    .get("/", ({ currentUser }: { currentUser: UserRecord }) => {
      return upstreamSourceService.listByOwner(currentUser.id);
    })
    .post("/", ({ body, currentUser, set }: { body: unknown; currentUser: UserRecord; set: { status?: number | string } }) => {
      try {
        const created = upstreamSourceService.create(currentUser.id, parseCreateBody(body));
        set.status = 201;
        return created;
      } catch (error) {
        return sendSourceError(error, set);
      }
    })
    .get("/:id", ({ params, currentUser, set }: { params: { id: string }; currentUser: UserRecord; set: { status?: number | string } }) => {
      try {
        return upstreamSourceService.getById(currentUser.id, params.id);
      } catch (error) {
        return sendSourceError(error, set);
      }
    })
    .patch("/:id", ({ params, body, currentUser, set }: { params: { id: string }; body: unknown; currentUser: UserRecord; set: { status?: number | string } }) => {
      try {
        return upstreamSourceService.update(currentUser.id, params.id, parseUpdateBody(body));
      } catch (error) {
        return sendSourceError(error, set);
      }
    })
    .post("/:id/sync", async ({ params, currentUser, set }: { params: { id: string }; currentUser: UserRecord; set: { status?: number | string } }) => {
      try {
        return await upstreamSourceService.sync(currentUser.id, params.id);
      } catch (error) {
        return sendSourceError(error, set);
      }
    })
    .delete("/:id", ({ params, currentUser, set }: { params: { id: string }; currentUser: UserRecord; set: { status?: number | string } }) => {
      try {
        return upstreamSourceService.delete(currentUser.id, params.id);
      } catch (error) {
        return sendSourceError(error, set);
      }
    });
};
