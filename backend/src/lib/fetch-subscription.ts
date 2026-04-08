import type { ProxyFetchResult } from "../types";

interface FetchSubscriptionOptions {
  etag?: string | null;
  lastModified?: string | null;
  timeoutMs?: number;
  retries?: number;
}

const buildAbortSignal = (timeoutMs: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout)
  };
};

const shouldRetry = (error: unknown, attempt: number, retries: number) => {
  if (attempt >= retries) {
    return false;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "AbortError" || /network|fetch|timeout|5\d\d/i.test(error.message);
};

export const fetchSubscriptionByUrl = async (
  url: string,
  options: FetchSubscriptionOptions = {}
): Promise<ProxyFetchResult & { text?: string; notModified?: boolean; httpStatus?: number }> => {
  const retries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? 12_000;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const { signal, cleanup } = buildAbortSignal(timeoutMs);

    try {
      const response = await fetch(url, {
        signal,
        headers: {
          "User-Agent": "clash-verge/v1.6.6",
          ...(options.etag ? { "If-None-Match": options.etag } : {}),
          ...(options.lastModified ? { "If-Modified-Since": options.lastModified } : {})
        }
      });

      if (response.status === 304) {
        return {
          status: "success",
          data: null,
          headers: Object.fromEntries(response.headers.entries()),
          lastModified: new Date(),
          errMsg: undefined,
          notModified: true,
          httpStatus: 304
        };
      }

      if (!response.ok) {
        throw new Error(`Request failed with ${response.status} ${response.statusText}`);
      }

      return {
        status: "success",
        data: null,
        headers: Object.fromEntries(response.headers.entries()),
        lastModified: new Date(),
        errMsg: undefined,
        text: await response.text(),
        httpStatus: response.status
      };
    } catch (error) {
      lastError = error;

      if (!shouldRetry(error, attempt, retries)) {
        break;
      }
    } finally {
      cleanup();
    }
  }

  return {
    status: "failed",
    errMsg: String(lastError),
    lastModified: new Date()
  };
};
