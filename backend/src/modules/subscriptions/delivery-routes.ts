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

const encodingQuality = (parameters: string[]): number => {
  const qualityParameters = parameters.filter((parameter) => {
    const separator = parameter.indexOf("=");
    return separator >= 0 && parameter.slice(0, separator).trim().toLowerCase() === "q";
  });
  if (qualityParameters.length === 0) return 1;
  if (qualityParameters.length > 1) return 0;

  const separator = qualityParameters[0]!.indexOf("=");
  const raw = qualityParameters[0]!.slice(separator + 1).trim();
  if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(raw)) return 0;
  return Number(raw);
};

// RFC 9110 content negotiation: an explicit coding takes precedence over `*`,
// and q=0 means the client explicitly refuses that representation.
const acceptsContentEncoding = (header: string | null, encoding: string): boolean => {
  if (!header) return false;
  const target = encoding.toLowerCase();
  const explicitQualities: number[] = [];
  const wildcardQualities: number[] = [];

  for (const entry of header.split(",")) {
    const [codingPart, ...parameters] = entry.split(";");
    const coding = codingPart?.trim().toLowerCase();
    if (!coding) continue;
    const quality = encodingQuality(parameters);
    if (coding === target) explicitQualities.push(quality);
    if (coding === "*") wildcardQualities.push(quality);
  }

  const qualities = explicitQualities.length > 0 ? explicitQualities : wildcardQualities;
  return qualities.length > 0 && Math.max(...qualities) > 0;
};

export const createDeliveryRoutes = (
  subscriptionService: SubscriptionService,
  rulesetService: RulesetService,
  rateLimiter: InMemoryRateLimiter
) => {
  const deliver = async (
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
      const acceptsGzip = acceptsContentEncoding(
        request.headers.get("accept-encoding"),
        "gzip"
      );
      const result = await subscriptionService.deliverForHttp(
        subscriptionId,
        token,
        kind,
        clientKey(request),
        request.headers.get("user-agent"),
        acceptsGzip
      );
      set.headers["content-type"] = "text/yaml; charset=utf-8";
      set.headers["content-disposition"] =
        `attachment; filename*=UTF-8''${encodeFileName(result.fileName)}`;
      for (const [key, value] of Object.entries(result.headers)) {
        set.headers[key] = value;
      }
      set.headers["cache-control"] = "no-cache";
      set.headers.vary = "Accept-Encoding";
      if (result.contentEncoding) {
        set.headers["content-encoding"] = result.contentEncoding;
        set.headers["content-length"] = String(result.body.byteLength);
      }
      return result.body;
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
