import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ClashProxyDocument } from "../src/types";
import type { BuildConfig } from "../src/lib/build-config/types";
import { computeNativeNodeId, identifyNodes } from "../src/lib/build-config/node-identity";
import { validateBuildConfig } from "../src/lib/build-config/validate";
import { emitClashYaml } from "../src/lib/render-v2/emit-yaml";
import { evaluate, type EvaluateInput } from "../src/lib/render-v2/evaluate";
import { diffDocuments } from "../src/lib/render-v2/release-diff";
import { SecretBox } from "../src/lib/security/secret-box";
import { randomBytes } from "node:crypto";

const goldenDir = resolve(import.meta.dir, "golden");

const expectGolden = (name: string, actual: string) => {
  const path = resolve(goldenDir, name);
  if (!existsSync(path) || process.env.UPDATE_GOLDEN === "1") {
    writeFileSync(path, actual);
    return;
  }
  expect(actual).toBe(readFileSync(path, "utf8"));
};

// ── 稳定 ID ──────────────────────────────────────────────────

describe("node-identity", () => {
  const base = { name: "HK-01", type: "ss", server: "1.2.3.4", port: 443, password: "a" };

  test("改名与换凭据不改变 ID", () => {
    const id = computeNativeNodeId(base);
    expect(computeNativeNodeId({ ...base, name: "🇭🇰 香港 01 x2" })).toBe(id);
    expect(computeNativeNodeId({ ...base, password: "rotated" })).toBe(id);
  });

  test("换 server 或 port 改变 ID", () => {
    const id = computeNativeNodeId(base);
    expect(computeNativeNodeId({ ...base, server: "5.6.7.8" })).not.toBe(id);
    expect(computeNativeNodeId({ ...base, port: 8443 })).not.toBe(id);
  });

  test("identity 冲突时按名称排序确定性去重", () => {
    const a = { name: "B", type: "ss", server: "1.1.1.1", port: 1 };
    const b = { name: "A", type: "ss", server: "1.1.1.1", port: 1 };
    const first = identifyNodes([a, b]);
    const second = identifyNodes([b, a]);
    const idOfA1 = first.find((item) => item.node.name === "A")!.id;
    const idOfA2 = second.find((item) => item.node.name === "A")!.id;
    expect(idOfA1).toBe(idOfA2);
    expect(new Set(first.map((item) => item.id)).size).toBe(2);
  });
});

// ── 校验器 ───────────────────────────────────────────────────

describe("validateBuildConfig", () => {
  test("拒绝多源 patch 模式并给出中文错误", () => {
    const result = validateBuildConfig({
      version: 1,
      mode: "patch",
      sources: [{ sourceId: "a" }, { sourceId: "b" }],
      rules: { final: { target: "Proxies" } }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join()).toContain("多来源必须使用重组模式");
    }
  });

  test("拒绝缺失 MATCH 落点", () => {
    const result = validateBuildConfig({
      version: 1,
      mode: "rebuild",
      sources: [{ sourceId: "a" }],
      rules: {}
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join()).toContain("MATCH");
    }
  });

  test("合法配置通过并归一化", () => {
    const result = validateBuildConfig({
      version: 1,
      mode: "rebuild",
      sources: [{ sourceId: "src_1" }],
      nodes: { transforms: [{ kind: "strip-emoji" }] },
      groups: {
        generators: [{ kind: "region-groups", groupType: "select", unclassified: "others" }]
      },
      rules: { final: { target: "DIRECT" } }
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sources[0]!.enabled).toBe(true);
      expect(result.value.nodes.custom).toEqual([]);
    }
  });
});

// ── 渲染管线 ─────────────────────────────────────────────────

const sourceDocument: ClashProxyDocument = {
  proxies: [
    { name: "🇭🇰 香港 01 x2", type: "ss", server: "hk1.example.com", port: 443, password: "p1" },
    { name: "🇭🇰 香港 02", type: "ss", server: "hk2.example.com", port: 443, password: "p2" },
    { name: "🇺🇸 美国 01", type: "vmess", server: "us1.example.com", port: 443, uuid: "u1" },
    { name: "神秘节点", type: "trojan", server: "x.example.com", port: 443, password: "p3" }
  ],
  "proxy-groups": [{ name: "SourceGroup", type: "select", proxies: ["🇭🇰 香港 01 x2"] }],
  rules: ["DOMAIN-SUFFIX,source.example,SourceGroup", "MATCH,SourceGroup"]
};

const hkNodeId = computeNativeNodeId({ type: "ss", server: "hk1.example.com", port: 443 });

const buildConfig: BuildConfig = {
  version: 1,
  mode: "rebuild",
  sources: [{ sourceId: "src_main", enabled: true }],
  nodes: {
    transforms: [{ kind: "strip-emoji" }, { kind: "strip-multiplier" }, { kind: "trim-whitespace" }],
    overrides: [{ nodeId: hkNodeId, rename: "HK-Prime" }],
    custom: [
      {
        id: "cn_home",
        name: "Home VPS",
        type: "trojan",
        server: "home.example.com",
        port: 443,
        secretRef: "sec_1",
        extra: { "skip-cert-verify": true },
        tags: ["US"]
      }
    ]
  },
  groups: {
    generators: [
      { kind: "proxies-root", name: "Proxies", includeAuto: true, extraMembers: [] },
      { kind: "region-groups", groupType: "select", unclassified: "others" }
    ],
    custom: [
      {
        name: "AI",
        type: "select",
        members: [
          { kind: "node", nodeId: "cn_home" },
          { kind: "selector", selector: { kind: "region", region: "US" } },
          { kind: "group", name: "Proxies" },
          { kind: "builtin", policy: "DIRECT" }
        ]
      }
    ],
    order: ["Proxies", "AI"]
  },
  rules: {
    targets: [
      {
        target: "AI",
        items: [
          {
            kind: "snapshot",
            catalogId: "cat_openai",
            slug: "geosite-openai",
            hash: "hash_openai",
            emit: "provider"
          },
          { kind: "manual", entries: [{ type: "DOMAIN-SUFFIX", value: "example.ai" }] }
        ]
      },
      {
        target: "DIRECT",
        items: [
          {
            kind: "snapshot",
            catalogId: "cat_cn",
            slug: "cn-small",
            hash: "hash_cn",
            emit: "inline"
          }
        ]
      }
    ],
    order: ["AI", "DIRECT"],
    prelude: [{ type: "PROCESS-NAME", value: "clash", target: "DIRECT" }],
    final: { target: "Proxies" }
  },
  config: {
    structured: { ports: { mixedPort: 7890 }, mode: "rule", logLevel: "info" },
    rawPatch: "unified-delay: true\n"
  }
};

const createInput = (overrides: Partial<EvaluateInput> = {}): EvaluateInput => ({
  buildConfig,
  sourceSnapshots: new Map([["src_main", sourceDocument]]),
  sourceLabels: new Map([["src_main", "白云机场"]]),
  rulesetSnapshots: new Map([
    [
      "hash_openai",
      {
        hash: "hash_openai",
        slug: "geosite-openai",
        behavior: "domain" as const,
        content: "payload:\n  - '+.openai.com'\n  - 'chatgpt.com'\n",
        isPublic: true
      }
    ],
    [
      "hash_cn",
      {
        hash: "hash_cn",
        slug: "cn-small",
        behavior: "domain" as const,
        content: "payload:\n  - '+.cn'\n  - 'baidu.com'\n",
        isPublic: true
      }
    ]
  ]),
  customNodeSecrets: new Map([["sec_1", { password: "home-secret" }]]),
  publicBaseUrl: "https://pp.example.com",
  ...overrides
});

describe("evaluate（rebuild）", () => {
  test("完整重组：结构正确且无 error issue", () => {
    const result = evaluate(createInput());
    const errors = result.issues.filter((issue) => issue.severity === "error");
    expect(errors).toEqual([]);

    // 转换与 override 生效
    const names = result.document.proxies.map((proxy) => proxy.name);
    expect(names).toContain("HK-Prime");
    expect(names).toContain("香港 02");
    expect(names).toContain("Home VPS");

    // 自建节点合入了解密字段
    const home = result.document.proxies.find((proxy) => proxy.name === "Home VPS")!;
    expect(home.password).toBe("home-secret");

    // 组：Proxies 根组在前，地区组存在，AI 组展开正确
    const groupNames = result.document["proxy-groups"].map((group) => group.name);
    expect(groupNames[0]).toBe("Proxies");
    expect(groupNames).toEqual(expect.arrayContaining(["HK", "US", "Others", "Auto", "AI"]));
    const ai = result.document["proxy-groups"].find((group) => group.name === "AI")!;
    expect(ai.proxies[0]).toBe("Home VPS");
    expect(ai.proxies).toContain("美国 01");
    expect(ai.proxies).toContain("Proxies");
    expect(ai.proxies).toContain("DIRECT");

    // 规则：前置在最前、provider 生成、inline 展开、MATCH 兜底最后
    const rules = result.document.rules ?? [];
    expect(rules[0]).toBe("PROCESS-NAME,clash,DIRECT");
    expect(rules).toContain("RULE-SET,geosite-openai,AI");
    expect(rules).toContain("DOMAIN-SUFFIX,cn,DIRECT");
    expect(rules).toContain("DOMAIN,baidu.com,DIRECT");
    expect(rules[rules.length - 1]).toBe("MATCH,Proxies");

    // provider 指向不可变哈希端点
    const providers = result.document["rule-providers"] as Record<string, Record<string, unknown>>;
    expect(providers["geosite-openai"]!.url).toBe("https://pp.example.com/rs/hash_openai.yaml");

    // rawPatch 深合并
    expect((result.document as Record<string, unknown>)["unified-delay"]).toBe(true);
  });

  test("classical 快照内联时把目标放在 no-resolve/src 修饰符之前", () => {
    const input = createInput();
    input.rulesetSnapshots.set("hash_cn", {
      hash: "hash_cn",
      slug: "cn-small",
      behavior: "classical",
      content: [
        "payload:",
        "  - GEOIP,CN,no-resolve",
        "  - IP-CIDR,10.0.0.0/8,no-resolve,src",
        "  - DOMAIN,example.cn",
        ""
      ].join("\n"),
      isPublic: true
    });

    const result = evaluate(input);
    const rules = result.document.rules ?? [];

    expect(rules).toContain("GEOIP,CN,DIRECT,no-resolve");
    expect(rules).toContain("IP-CIDR,10.0.0.0/8,DIRECT,no-resolve,src");
    expect(rules).toContain("DOMAIN,example.cn,DIRECT");
    expect(rules).not.toContain("GEOIP,CN,no-resolve,DIRECT");
  });

  test("确定性：同输入双跑字节一致", () => {
    const first = evaluate(createInput());
    const second = evaluate(createInput());
    expect(first.yamlText).toBe(second.yamlText);
    expect(first.renderedHash).toBe(second.renderedHash);
  });

  test("golden：锁定 YAML 字节输出", () => {
    const result = evaluate(createInput());
    expectGolden("basic-rebuild.yaml", result.yamlText);
  });

  test("引用已消失的节点产生 error issue", () => {
    const config: BuildConfig = JSON.parse(JSON.stringify(buildConfig));
    config.groups.custom[0]!.members.unshift({ kind: "node", nodeId: "n_deadbeef0000" });
    const result = evaluate(createInput({ buildConfig: config }));
    const issue = result.issues.find((item) => item.kind === "dangling-node-ref");
    expect(issue?.severity).toBe("error");
  });

  test("规则块目标不存在时整块跳过并报 error", () => {
    const config: BuildConfig = JSON.parse(JSON.stringify(buildConfig));
    config.rules.targets.push({
      target: "Ghost",
      items: [{ kind: "manual", entries: [{ type: "DOMAIN", value: "x.com" }] }]
    });
    const result = evaluate(createInput({ buildConfig: config }));
    expect(result.issues.some((item) => item.kind === "dangling-rule-target")).toBe(true);
    expect(result.document.rules).not.toContain("DOMAIN,x.com,Ghost");
  });

  test("rawPatch 禁止触碰 proxies 等保留键", () => {
    const config: BuildConfig = JSON.parse(JSON.stringify(buildConfig));
    config.config.rawPatch = "proxies: []\n";
    const result = evaluate(createInput({ buildConfig: config }));
    expect(result.issues.some((item) => item.kind === "invalid-raw-patch")).toBe(true);
    expect(result.document.proxies.length).toBeGreaterThan(0);
  });
});

describe("evaluate（patch）", () => {
  test("保留源配置：注入自建节点与规则，改名传播到源组", () => {
    const config: BuildConfig = {
      ...JSON.parse(JSON.stringify(buildConfig)),
      mode: "patch",
      groups: { generators: [], custom: [], order: [] },
      rules: {
        targets: [
          {
            target: "SourceGroup",
            items: [{ kind: "manual", entries: [{ type: "DOMAIN-SUFFIX", value: "added.example" }] }]
          }
        ],
        order: ["SourceGroup"],
        prelude: [],
        final: { target: "SourceGroup" }
      }
    };
    const result = evaluate(createInput({ buildConfig: config }));
    const errors = result.issues.filter((issue) => issue.severity === "error");
    expect(errors).toEqual([]);

    // 源组保留且改名传播
    const sourceGroup = result.document["proxy-groups"].find((group) => group.name === "SourceGroup")!;
    expect(sourceGroup.proxies).toContain("HK-Prime");

    // 我们的规则插入在源 MATCH 之前，源 MATCH 保留为兜底
    const rules = result.document.rules ?? [];
    expect(rules[rules.length - 1]).toBe("MATCH,SourceGroup");
    expect(rules).toContain("DOMAIN-SUFFIX,added.example,SourceGroup");

    // 自建节点已注入
    expect(result.document.proxies.map((proxy) => proxy.name)).toContain("Home VPS");
  });
});

// ── emitter ──────────────────────────────────────────────────

describe("emitClashYaml", () => {
  test("键插入顺序不同输出一致", () => {
    const a = { rules: ["MATCH,DIRECT"], mode: "rule", proxies: [], "proxy-groups": [] };
    const b = { mode: "rule", proxies: [], rules: ["MATCH,DIRECT"], "proxy-groups": [] };
    expect(emitClashYaml(a)).toBe(emitClashYaml(b));
  });

  test("中文与特殊字符往返无损", () => {
    const doc = {
      proxies: [{ name: "特殊:名字 #井号 0123", type: "ss", server: "s", port: 1 }],
      "proxy-groups": [],
      rules: []
    };
    const text = emitClashYaml(doc);
    expect(text).toBe(emitClashYaml(doc));
    expect(text).toContain("特殊:名字 #井号 0123");
  });
});

// ── diff 与 secret ───────────────────────────────────────────

describe("diffDocuments", () => {
  test("识别新增、改名、凭据轮换与组变化", () => {
    const before: ClashProxyDocument = {
      proxies: [
        { name: "HK-01", type: "ss", server: "hk1", port: 1, password: "a" },
        { name: "US-01", type: "ss", server: "us1", port: 1, password: "a" }
      ],
      "proxy-groups": [{ name: "G", type: "select", proxies: ["HK-01"] }],
      rules: ["MATCH,G"]
    };
    const after: ClashProxyDocument = {
      proxies: [
        { name: "HK-Prime", type: "ss", server: "hk1", port: 1, password: "a" },
        { name: "US-01", type: "ss", server: "us1", port: 1, password: "rotated" },
        { name: "SG-01", type: "ss", server: "sg1", port: 1, password: "a" }
      ],
      "proxy-groups": [{ name: "G", type: "select", proxies: ["HK-Prime", "SG-01"] }],
      rules: ["MATCH,G"]
    };
    const diff = diffDocuments(before, after);
    expect(diff.nodes.renamed).toEqual([{ from: "HK-01", to: "HK-Prime" }]);
    expect(diff.nodes.updated).toEqual(["US-01"]);
    expect(diff.nodes.added).toEqual(["SG-01"]);
    expect(diff.groups.membersChanged).toEqual(["G"]);
    expect(diff.identical).toBe(false);
  });

  test("相同文档 identical=true", () => {
    const doc: ClashProxyDocument = {
      proxies: [{ name: "A", type: "ss", server: "s", port: 1 }],
      "proxy-groups": [{ name: "G", type: "select", proxies: ["A"] }],
      rules: ["MATCH,G"]
    };
    expect(diffDocuments(JSON.parse(JSON.stringify(doc)), doc).identical).toBe(true);
  });
});

describe("SecretBox", () => {
  test("加解密往返", () => {
    const box = new SecretBox(randomBytes(32));
    const fields = { password: "秘密", uuid: "abc" };
    expect(box.decrypt(box.encrypt(fields))).toEqual(fields);
  });
});
