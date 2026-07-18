import { Elysia } from "elysia";

import { NodeUriParseError, parseNodeShareUri } from "../../lib/nodes/share-uri";
import type { AuthService } from "../auth/auth.service";

export const createNodeRoutes = (authService: AuthService) =>
  new Elysia({ prefix: "/api/nodes" })
    .derive(({ headers }) => ({ currentUser: authService.authenticate(headers.authorization) }))
    .post("/parse-uri", ({ body, set }) => {
      set.headers["cache-control"] = "no-store";
      set.headers.pragma = "no-cache";
      try {
        const uri = body && typeof body === "object" && "uri" in body ? (body as { uri?: unknown }).uri : null;
        if (typeof uri !== "string") throw new NodeUriParseError("请求缺少 uri 字段。");
        return parseNodeShareUri(uri);
      } catch (error) {
        if (error instanceof NodeUriParseError) {
          set.status = 400;
          return { message: error.message };
        }
        throw error;
      }
    });
