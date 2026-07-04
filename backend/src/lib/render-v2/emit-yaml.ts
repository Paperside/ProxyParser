import yaml from "js-yaml";

// 规范化 YAML 出口（技术方案 §4.2）。
// 全仓库唯一允许把配置对象序列化为 YAML 的地方——golden 测试锁定其字节行为。
// 确定性来源：固定键序构造 + lineWidth: -1（禁止长行折叠）+ 显式排序。

const TOP_LEVEL_ORDER = [
  "mixed-port",
  "port",
  "socks-port",
  "redir-port",
  "tproxy-port",
  "mode",
  "log-level",
  "ipv6",
  "allow-lan",
  "bind-address",
  "external-controller",
  "secret",
  "unified-delay",
  "tcp-concurrent",
  "dns",
  "tun",
  "sniffer",
  "profile"
] as const;

const TAIL_ORDER = ["proxies", "proxy-groups", "rule-providers", "rules"] as const;

const PROXY_KEY_ORDER = ["name", "type", "server", "port"] as const;
const GROUP_KEY_ORDER = ["name", "type"] as const;
const PROVIDER_KEY_ORDER = ["type", "behavior", "format", "url", "path", "interval"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// 按 head 键序 + 其余字典序（可选把某些键放到最后）重建对象
const orderKeys = (
  value: Record<string, unknown>,
  head: readonly string[],
  tail: readonly string[] = []
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  const used = new Set<string>();

  for (const key of head) {
    if (key in value && value[key] !== undefined) {
      result[key] = value[key];
      used.add(key);
    }
  }

  const middle = Object.keys(value)
    .filter((key) => !used.has(key) && !tail.includes(key) && value[key] !== undefined)
    .sort((a, b) => a.localeCompare(b));
  for (const key of middle) {
    result[key] = value[key];
  }

  for (const key of tail) {
    if (key in value && value[key] !== undefined) {
      result[key] = value[key];
      used.add(key);
    }
  }

  return result;
};

export const emitClashYaml = (document: Record<string, unknown>): string => {
  const canonical: Record<string, unknown> = {};

  for (const key of TOP_LEVEL_ORDER) {
    if (key in document && document[key] !== undefined) {
      canonical[key] = document[key];
    }
  }

  const known = new Set<string>([...TOP_LEVEL_ORDER, ...TAIL_ORDER]);
  const middleKeys = Object.keys(document)
    .filter((key) => !known.has(key) && document[key] !== undefined)
    .sort((a, b) => a.localeCompare(b));
  for (const key of middleKeys) {
    canonical[key] = document[key];
  }

  const proxies = document.proxies;
  if (Array.isArray(proxies)) {
    canonical.proxies = proxies.map((proxy) =>
      isRecord(proxy) ? orderKeys(proxy, PROXY_KEY_ORDER) : proxy
    );
  }

  const groups = document["proxy-groups"];
  if (Array.isArray(groups)) {
    canonical["proxy-groups"] = groups.map((group) =>
      isRecord(group) ? orderKeys(group, GROUP_KEY_ORDER, ["proxies"]) : group
    );
  }

  const providers = document["rule-providers"];
  if (isRecord(providers) && Object.keys(providers).length > 0) {
    const ordered: Record<string, unknown> = {};
    for (const slug of Object.keys(providers).sort((a, b) => a.localeCompare(b))) {
      const entry = providers[slug];
      ordered[slug] = isRecord(entry) ? orderKeys(entry, PROVIDER_KEY_ORDER) : entry;
    }
    canonical["rule-providers"] = ordered;
  }

  if (Array.isArray(document.rules)) {
    canonical.rules = document.rules;
  }

  return yaml.dump(canonical, {
    noRefs: true,
    lineWidth: -1,
    sortKeys: false
  });
};
