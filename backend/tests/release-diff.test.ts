import { describe, expect, test } from "bun:test";

import { diffDocuments } from "../src/lib/render-v2/release-diff";
import type { ClashProxyDocument } from "../src/types";

const makeDocument = (provider: Record<string, unknown>): ClashProxyDocument => ({
  proxies: [],
  "proxy-groups": [],
  "rule-providers": {
    chinamax: provider
  },
  rules: ["RULE-SET,chinamax,DIRECT", "MATCH,DIRECT"]
});

describe("diffDocuments rule providers", () => {
  test.each([
    ["url", "https://example.com/rs/old.yaml", "https://example.com/rs/new.yaml"],
    ["path", "./rule-providers/old.yaml", "./rule-providers/new.yaml"]
  ])("provider %s 变化会进入配置差异", (field, beforeValue, afterValue) => {
    const before = makeDocument({
      type: "http",
      behavior: "classical",
      url: "https://example.com/rs/old.yaml",
      path: "./rule-providers/old.yaml"
    });
    const after = structuredClone(before);
    const provider = (after["rule-providers"] as Record<string, Record<string, unknown>>)
      .chinamax;
    provider[field] = afterValue;
    const previousProvider = (
      before["rule-providers"] as Record<string, Record<string, unknown>>
    ).chinamax;
    previousProvider[field] = beforeValue;

    const diff = diffDocuments(before, after);

    expect(diff.configKeysChanged).toEqual(["rule-providers"]);
    expect(diff.identical).toBe(false);
    expect(diff.nodes).toEqual({ added: [], removed: [], renamed: [], updated: [] });
    expect(diff.groups).toEqual({ added: [], removed: [], membersChanged: [] });
    expect(diff.ruleCountDelta).toBe(0);
  });
});
