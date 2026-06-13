import type { SubscriptionUsageInfo } from "../types";

const parseNullableNumber = (value: string | undefined) => {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const findSubscriptionUserInfoHeader = (
  headers: Record<string, string> | null | undefined
): string | null => {
  if (!headers) {
    return null;
  }

  for (const [key, value] of Object.entries(headers)) {
    const normalized = key.toLowerCase();

    if (
      normalized === "subscription-userinfo" ||
      normalized.endsWith("-subscription-userinfo")
    ) {
      return value;
    }
  }

  return null;
};

export const parseSubscriptionUserInfo = (
  value: string | null | undefined
): SubscriptionUsageInfo | null => {
  if (!value) {
    return null;
  }

  const segments = value
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  const fields = new Map<string, string>();

  for (const segment of segments) {
    const [key, rawValue] = segment.split("=");

    if (!key || rawValue === undefined) {
      continue;
    }

    fields.set(key.trim().toLowerCase(), rawValue.trim());
  }

  return {
    upload: parseNullableNumber(fields.get("upload")),
    download: parseNullableNumber(fields.get("download")),
    total: parseNullableNumber(fields.get("total")),
    expire: parseNullableNumber(fields.get("expire"))
  };
};
