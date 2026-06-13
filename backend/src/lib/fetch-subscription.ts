import yaml from "js-yaml";

import type { ClashProxyDocument, ProxyFetchResult } from "../types";

interface FetchSubscriptionOptions {
  etag?: string | null;
  lastModified?: string | null;
  timeoutMs?: number;
  retries?: number;
  userAgent?: string;
}

const DEFAULT_SUBSCRIPTION_USER_AGENT = "clash-verge/v2.5.2";
const DEFAULT_SUBSCRIPTION_ACCEPT = "application/x-yaml, text/yaml, application/yaml, text/plain, */*";

const buildAbortSignal = (timeoutMs: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout)
  };
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const looksLikeClashDocument = (text: string) => {
  try {
    const parsed = yaml.load(text) as Partial<ClashProxyDocument> | null;

    return (
      isObject(parsed) &&
      (Array.isArray(parsed.proxies) || Array.isArray(parsed["proxy-providers"]))
    );
  } catch {
    return false;
  }
};

const looksLikeHtmlDocument = (text: string) => /^\s*<!doctype html\b|^\s*<html\b/i.test(text);

const looksLikeRedirectToBaidu = (response: Response, text: string) => {
  const location = response.headers.get("location") ?? "";
  return /baidu\.com/i.test(location) || /<title>\s*百度一下/i.test(text);
};

const looksLikeInvalidSubscriptionResponse = (response: Response, text: string) => {
  if (!looksLikeHtmlDocument(text)) {
    return false;
  }

  return response.status >= 300 || looksLikeRedirectToBaidu(response, text);
};

const shouldRetry = (error: unknown, attempt: number, retries: number) => {
  if (attempt >= retries) {
    return false;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "AbortError" ||
    /network|fetch|timeout|5\d\d|html redirect/i.test(error.message)
  );
};

export const fetchSubscriptionByUrl = async (
  url: string,
  options: FetchSubscriptionOptions = {}
): Promise<ProxyFetchResult & { text?: string; notModified?: boolean; httpStatus?: number }> => {
  const retries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? 20_000;
  let lastError: unknown = null;
  let lastResponse:
    | { headers: Record<string, string>; text: string; httpStatus: number }
    | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const { signal, cleanup } = buildAbortSignal(timeoutMs);

    try {
      const response = await fetch(url, {
        signal,
        redirect: "manual",
        headers: {
          "user-agent": options.userAgent ?? DEFAULT_SUBSCRIPTION_USER_AGENT,
          accept: DEFAULT_SUBSCRIPTION_ACCEPT,
          ...(options.etag ? { "if-none-match": options.etag } : {}),
          ...(options.lastModified ? { "if-modified-since": options.lastModified } : {})
        }
      });
      const headers = Object.fromEntries(response.headers.entries());

      if (response.status === 304) {
        return {
          status: "success",
          data: null,
          headers,
          lastModified: new Date(),
          errMsg: undefined,
          notModified: true,
          httpStatus: 304
        };
      }

      const text = await response.text();
      lastResponse = {
        headers,
        text,
        httpStatus: response.status
      };

      if (looksLikeInvalidSubscriptionResponse(response, text)) {
        throw new Error("Subscription endpoint returned an HTML redirect page instead of YAML");
      }

      if (!response.ok) {
        throw new Error(`Request failed with ${response.status} ${response.statusText}`);
      }

      return {
        status: "success",
        data: null,
        headers,
        lastModified: new Date(),
        errMsg: undefined,
        text,
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

  if (lastResponse && looksLikeClashDocument(lastResponse.text)) {
    return {
      status: "success",
      data: null,
      headers: lastResponse.headers,
      lastModified: new Date(),
      errMsg: undefined,
      text: lastResponse.text,
      httpStatus: lastResponse.httpStatus
    };
  }

  return {
    status: "failed",
    errMsg: String(lastError),
    lastModified: new Date()
  };
};
