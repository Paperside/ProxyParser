export interface RateLimitPolicy {
  keyPrefix: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
  retryAfterSeconds: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweepAt = 0;

  consume(subject: string, policy: RateLimitPolicy): RateLimitResult {
    const now = Date.now();
    this.sweep(now);
    const key = `${policy.keyPrefix}:${subject}`;
    const current = this.buckets.get(key);

    if (!current || current.resetAt <= now) {
      const resetAt = now + policy.windowMs;
      const nextBucket = {
        count: 1,
        resetAt
      };
      this.buckets.set(key, nextBucket);
      return {
        allowed: true,
        limit: policy.limit,
        remaining: Math.max(policy.limit - 1, 0),
        resetAt: new Date(resetAt).toISOString(),
        retryAfterSeconds: Math.ceil(policy.windowMs / 1000)
      };
    }

    if (current.count >= policy.limit) {
      return {
        allowed: false,
        limit: policy.limit,
        remaining: 0,
        resetAt: new Date(current.resetAt).toISOString(),
        retryAfterSeconds: Math.max(Math.ceil((current.resetAt - now) / 1000), 1)
      };
    }

    current.count += 1;
    return {
      allowed: true,
      limit: policy.limit,
      remaining: Math.max(policy.limit - current.count, 0),
      resetAt: new Date(current.resetAt).toISOString(),
      retryAfterSeconds: Math.max(Math.ceil((current.resetAt - now) / 1000), 1)
    };
  }

  private sweep(now: number) {
    if (now - this.lastSweepAt < 60 * 1000) {
      return;
    }

    this.lastSweepAt = now;

    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}

export const resolveRateLimitSubject = (request: Request) => {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    const [clientIp] = forwardedFor.split(",");

    if (clientIp?.trim()) {
      return clientIp.trim();
    }
  }

  const connectingIp =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("fly-client-ip");

  if (connectingIp?.trim()) {
    return connectingIp.trim();
  }

  return "local";
};

export const applyRateLimitHeaders = (
  set: { headers?: Record<string, string | number | string[] | undefined> },
  result: RateLimitResult
) => {
  const headers = (set.headers ??= {});
  headers["x-ratelimit-limit"] = String(result.limit);
  headers["x-ratelimit-remaining"] = String(result.remaining);
  headers["x-ratelimit-reset"] = result.resetAt;
  headers["retry-after"] = String(result.retryAfterSeconds);
};
