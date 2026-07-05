import { Elysia } from "elysia";

import type { AuthService } from "../auth/auth.service";
import type { UserRecord } from "../users/user.repository";
import { searchRulesetDirectory } from "../../lib/rulesets/directory";
import { RulesetError, RulesetService } from "./ruleset.service";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const str = (source: Record<string, unknown>, key: string) => {
  const value = source[key];
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const sendError = (error: unknown, set: { status?: number | string }) => {
  if (error instanceof RulesetError) {
    set.status = error.status;
    return { message: error.message };
  }
  throw error;
};

type Ctx = {
  currentUser: UserRecord;
  set: { status?: number | string };
  params: Record<string, string>;
  body: unknown;
  query: Record<string, string | undefined>;
};

export const createRulesetRoutes = (authService: AuthService, service: RulesetService) => {
  return new Elysia({ prefix: "/api/rulesets" })
    .derive(({ headers }) => ({
      currentUser: authService.authenticate(headers.authorization)
    }))
    .get("/", ({ currentUser }: Pick<Ctx, "currentUser">) => service.list(currentUser.id))
    // 扩展目录：blackmatrix7 全量规则组的只读索引，搜索 + 分页浏览，导入前不落库
    .get("/directory", ({ query }: Pick<Ctx, "query">) =>
      searchRulesetDirectory(
        query.q ?? null,
        Number.parseInt(query.page ?? "1", 10) || 1,
        Number.parseInt(query.pageSize ?? "30", 10) || 30
      )
    )
    .get("/:id", ({ params, currentUser, set }: Omit<Ctx, "body" | "query">) => {
      try {
        return service.getById(currentUser.id, params.id!);
      } catch (error) {
        return sendError(error, set);
      }
    })
    // 导入到订阅前：确保有可引用的最新快照
    .post(
      "/:id/ensure-snapshot",
      async ({ params, currentUser, set }: Omit<Ctx, "body" | "query">) => {
        try {
          const snapshot = await service.ensureLatestSnapshot(currentUser.id, params.id!);
          return {
            hash: snapshot.hash,
            behavior: snapshot.behavior,
            entryCount: snapshot.entryCount,
            fetchedAt: snapshot.fetchedAt
          };
        } catch (error) {
          return sendError(error, set);
        }
      }
    )
    // 手动检查更新
    .post("/:id/refresh", async ({ params, currentUser, set }: Omit<Ctx, "body" | "query">) => {
      try {
        service.getById(currentUser.id, params.id!);
        const result = await service.checkForUpdates(params.id!);
        return { ...result, catalog: service.getById(currentUser.id, params.id!) };
      } catch (error) {
        return sendError(error, set);
      }
    })
    // 两个快照的差异
    .get(
      "/:id/diff",
      ({ params, query, currentUser, set }: Omit<Ctx, "body">) => {
        try {
          service.getById(currentUser.id, params.id!);
          const toHash = query.to;
          if (!toHash) {
            throw new RulesetError("缺少 to 参数（目标快照 hash）。");
          }
          return service.diffSnapshots(query.from ?? null, toHash);
        } catch (error) {
          return sendError(error, set);
        }
      }
    )
    // 从 URL 导入自定义规则源
    .post("/import", async ({ body, currentUser, set }: Omit<Ctx, "params" | "query">) => {
      try {
        if (!isRecord(body)) throw new RulesetError("请求体格式错误。");
        const behavior = str(body, "behavior");
        const created = await service.importFromUrl(currentUser.id, {
          name: str(body, "name") ?? "自定义规则源",
          sourceUrl: str(body, "sourceUrl") ?? "",
          behavior:
            behavior === "domain" || behavior === "ipcidr" ? behavior : "classical",
          recommendedTarget: str(body, "recommendedTarget")
        });
        set.status = 201;
        return created;
      } catch (error) {
        return sendError(error, set);
      }
    })
    // 粘贴规则解析（不落库，返回规范化报告，前端确认后写入 BuildConfig）
    .post("/parse", ({ body, set }: Omit<Ctx, "params" | "query" | "currentUser">) => {
      try {
        if (!isRecord(body) || typeof body.text !== "string") {
          throw new RulesetError("缺少 text。");
        }
        return service.parsePaste(body.text);
      } catch (error) {
        return sendError(error, set);
      }
    });
};
