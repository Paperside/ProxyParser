import yaml from "js-yaml";

import type { ClashProxyDocument } from "../types";

const isClashProxyDocument = (value: unknown): value is ClashProxyDocument => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as ClashProxyDocument;
  return Array.isArray(candidate.proxies) && Array.isArray(candidate["proxy-groups"]);
};

export const parseProxyWithString = (
  yamlText: string
): ClashProxyDocument | null => {
  try {
    const parsed = yaml.load(yamlText);
    return isClashProxyDocument(parsed) ? parsed : null;
  } catch (error) {
    console.error("Failed to parse proxy yaml", error);
    return null;
  }
};
