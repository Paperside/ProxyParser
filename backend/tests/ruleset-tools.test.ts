import { describe, expect, test } from "bun:test";

import {
  selectManifestEntries,
  type ManifestEntry
} from "../scripts/fetch-rulesets";

const entry = (slug: string): ManifestEntry => ({
  slug,
  sources: [],
  extraRules: [],
  file: `${slug}.yaml`
});

describe("fetch-rulesets slug 过滤", () => {
  test("无参数更新全部，指定 slug 精确过滤，并拒绝未知 slug", () => {
    const entries = [entry("anthropic"), entry("chinamax")];

    expect(selectManifestEntries(entries, [])).toEqual(entries);
    expect(selectManifestEntries(entries, ["chinamax"])).toEqual([entries[1]]);
    expect(() => selectManifestEntries(entries, ["missing"])).toThrow(
      "未知内置规则集：missing"
    );
  });
});
