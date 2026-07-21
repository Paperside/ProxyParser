import { describe, expect, test } from "bun:test";

import {
  selectManifestEntries,
  type ManifestEntry
} from "../scripts/fetch-rulesets";
import { mergeMultiSourceRuleset } from "../src/lib/rulesets/merge";

const payloadUrl = (entries: string[]) =>
  `data:text/yaml;charset=utf-8,${encodeURIComponent([
    "payload:",
    ...entries.map((item) => `  - '${item}'`),
    ""
  ].join("\n"))}`;

const entry = (slug: string): ManifestEntry => ({
  slug,
  behavior: "classical",
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

  test("按目标 behavior 生成纯 domain 与 ipcidr payload", async () => {
    const domain = await mergeMultiSourceRuleset(
      {
        sources: [
          { kind: "domain", url: payloadUrl(["example.cn", "+.bilibili.com"]) }
        ],
        extraRules: []
      },
      "domain"
    );
    expect(domain.content).toContain("- example.cn");
    expect(domain.content).toContain("- +.bilibili.com");
    expect(domain.content).not.toContain("DOMAIN-SUFFIX");

    const ipcidr = await mergeMultiSourceRuleset(
      {
        sources: [
          { kind: "ipcidr", url: payloadUrl(["58.19.0.0/16", "2408:8000::/20"]) },
          {
            kind: "classical",
            url: payloadUrl([
              "DOMAIN-SUFFIX,example.cn",
              "IP-CIDR,58.19.0.0/16,no-resolve",
              "IP-CIDR6,2408:8000::/20,no-resolve"
            ])
          }
        ],
        extraRules: []
      },
      "ipcidr"
    );
    expect(ipcidr.entryCount).toBe(2);
    expect(ipcidr.content).toContain("- 58.19.0.0/16");
    expect(ipcidr.content).toContain("- 2408:8000::/20");
    expect(ipcidr.content).not.toContain("DOMAIN-SUFFIX");
    expect(ipcidr.content).not.toContain("IP-CIDR,");
  });

  test("extraRules 必须与目标 behavior 一致", async () => {
    const ipcidr = await mergeMultiSourceRuleset(
      { sources: [], extraRules: ["58.19.0.0/16"] },
      "ipcidr"
    );
    expect(ipcidr.entryCount).toBe(1);
    expect(ipcidr.content).toContain("- 58.19.0.0/16");

    await expect(
      mergeMultiSourceRuleset(
        { sources: [], extraRules: ["GEOIP,CN,no-resolve"] },
        "ipcidr"
      )
    ).rejects.toThrow("ipcidr extraRules 只能包含 CIDR");
  });
});
