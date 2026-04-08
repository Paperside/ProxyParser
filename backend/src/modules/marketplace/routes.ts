import { Elysia } from "elysia";

import type { AuthService } from "../auth/auth.service";
import { MarketplaceRepository } from "./marketplace.repository";
import { RulesetCatalogError, RulesetCatalogService } from "./ruleset-catalog.service";

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

const parseRulesetBody = (body: unknown) => {
  if (!isRecord(body)) {
    throw new RulesetCatalogError("请求体格式错误。", 400);
  }

  return {
    name: optionalString(body, "name"),
    slug: optionalString(body, "slug"),
    description: optionalString(body, "description"),
    sourceUrl: optionalString(body, "sourceUrl"),
    visibility: optionalString(body, "visibility") as
      | "private"
      | "unlisted"
      | "public"
      | undefined,
    behavior: optionalString(body, "behavior") as
      | "domain"
      | "ipcidr"
      | "classical"
      | undefined,
    status: optionalString(body, "status") as
      | "active"
      | "disabled"
      | "archived"
      | undefined
  };
};

const sendRulesetError = (error: unknown, set: { status?: number | string }) => {
  if (error instanceof RulesetCatalogError) {
    set.status = error.status;
    return {
      message: error.message
    };
  }

  throw error;
};

export const createMarketplaceRoutes = (repository: MarketplaceRepository) => {
  return new Elysia({ prefix: "/api/marketplace" })
    .get("/rulesets", () => {
      return repository.listPublicRulesets();
    })
    .get("/rulesets/:slug", ({ params, set }) => {
      const detail = repository.getPublicRulesetBySlug(params.slug);

      if (!detail) {
        set.status = 404;
        return {
          message: "未找到该规则源。"
        };
      }

      return detail;
    })
    .get("/rulesets/:slug/content", ({ params, set }) => {
      const detail = repository.getPublicRulesetBySlug(params.slug);

      if (!detail || !detail.latestContentText) {
        set.status = 404;
        return {
          message: "未找到该规则内容。"
        };
      }

      set.headers = {
        "content-type": "text/yaml; charset=utf-8"
      };

      return detail.latestContentText;
    })
    .get("/templates", () => {
      return repository.listPublicTemplates();
    });
};

export const createRulesetCatalogRoutes = (
  authService: AuthService,
  rulesetCatalogService: RulesetCatalogService
) => {
  return new Elysia({ prefix: "/api/rulesets" })
    .get("/", ({ headers, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        return rulesetCatalogService.listAccessible(user.id);
      } catch (error) {
        return sendRulesetError(error, set);
      }
    })
    .post("/", async ({ headers, body, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        const parsed = parseRulesetBody(body);
        const created = await rulesetCatalogService.create(user.id, {
          ...parsed,
          name: parsed.name ?? "",
          sourceUrl: parsed.sourceUrl ?? ""
        });
        set.status = 201;
        return created;
      } catch (error) {
        return sendRulesetError(error, set);
      }
    })
    .get("/:id", ({ headers, params, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        return rulesetCatalogService.getOwned(user.id, params.id);
      } catch (error) {
        return sendRulesetError(error, set);
      }
    })
    .patch("/:id", async ({ headers, params, body, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        return await rulesetCatalogService.update(user.id, params.id, parseRulesetBody(body));
      } catch (error) {
        return sendRulesetError(error, set);
      }
    })
    .post("/:id/sync", async ({ headers, params, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        return await rulesetCatalogService.sync(user.id, params.id);
      } catch (error) {
        return sendRulesetError(error, set);
      }
    })
    .delete("/:id", ({ headers, params, set }) => {
      try {
        const user = authService.authenticate(headers.authorization);
        return rulesetCatalogService.delete(user.id, params.id);
      } catch (error) {
        return sendRulesetError(error, set);
      }
    });
};
