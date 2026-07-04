import { Elysia } from "elysia";

import { logger } from "../../lib/logging/logger";
import type { InMemoryRateLimiter } from "../../lib/security/rate-limiter";
import type { RulesetService } from "../rulesets/ruleset.service";
import { SubscriptionError, SubscriptionService } from "./subscription.service";

// 公开交付端点（技术方案 §7）：
//   GET /s/:subId/:token        长期链接 → active release，零上游请求、零渲染
//   GET /s/:subId/t/:temp       短期分享链接
//   GET /rs/:hash.yaml          不可变规则快照（仅公开内容）

const pullPolicy = { keyPrefix: "delivery:pull", limit: 120, windowMs: 60_000 } as const;
const rulesetPolicy = { keyPrefix: "delivery:ruleset", limit: 240, windowMs: 60_000 } as const;

const clientKey = (request: Request) =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

const encodeFileName = (name: string) => encodeURIComponent(name).replaceAll("'", "%27");

export const createDeliveryRoutes = (
  subscriptionService: SubscriptionService,
  rulesetService: RulesetService,
  rateLimiter: InMemoryRateLimiter
) => {
  const deliver = (
    kind: "token" | "temp_token",
    subscriptionId: string,
    token: string,
    request: Request,
    set: { status?: number | string; headers: Record<string, string> }
  ) => {
    const limit = rateLimiter.consume(clientKey(request), pullPolicy);
    if (!limit.allowed) {
      set.status = 429;
      return "拉取过于频繁，请稍后再试。";
    }
    try {
      const result = subscriptionService.deliver(
        subscriptionId,
        token,
        kind,
        clientKey(request),
        request.headers.get("user-agent")
      );
      set.headers["content-type"] = "text/yaml; charset=utf-8";
      set.headers["content-disposition"] =
        `attachment; filename*=UTF-8''${encodeFileName(result.fileName)}`;
      for (const [key, value] of Object.entries(result.headers)) {
        set.headers[key] = value;
      }
      return result.yamlText;
    } catch (error) {
      if (error instanceof SubscriptionError) {
        set.status = error.status;
        return error.message;
      }
      logger.error({
        event: "delivery.failed",
        subscriptionId,
        error: error instanceof Error ? error.message : String(error)
      });
      set.status = 500;
      return "内部错误。";
    }
  };

  return new Elysia()
    .get("/s/:subId/t/:token", ({ params, request, set }) =>
      deliver("temp_token", params.subId, params.token, request, set as never)
    )
    .get("/s/:subId/:token", ({ params, request, set }) =>
      deliver("token", params.subId, params.token, request, set as never)
    )
    .get("/rs/:file", ({ params, request, set }) => {
      const limit = rateLimiter.consume(clientKey(request), rulesetPolicy);
      if (!limit.allowed) {
        set.status = 429;
        return "请求过于频繁。";
      }
      const hash = params.file.endsWith(".yaml") ? params.file.slice(0, -5) : params.file;
      const snapshot = rulesetService.getPublicSnapshot(hash);
      if (!snapshot) {
        set.status = 404;
        return "规则快照不存在。";
      }
      set.headers["content-type"] = "text/yaml; charset=utf-8";
      // 内容寻址 → 永久不可变，客户端与 CDN 可无限缓存
      set.headers["cache-control"] = "public, max-age=31536000, immutable";
      return snapshot.content;
    });
};
