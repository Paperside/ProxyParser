import type { ProxyGroupEntry, ProxyNode } from "../../types";

export interface AutoGroupRenderOptions {
  enabled?: boolean;
  includeAutoGroup?: boolean;
  unclassifiedPolicy?: "others" | "ignore";
}

export interface AutoGroupRenderResult {
  groups: ProxyGroupEntry[];
  unclassifiedProxyNames: string[];
}

const REGION_MATCHERS: Array<{
  name: string;
  pattern: RegExp;
}> = [
  { name: "HK", pattern: /港|HK|Hong ?Kong|HKG/i },
  { name: "JP", pattern: /日本|东京|大阪|JP|Japan|Tokyo|NRT|KIX/i },
  {
    name: "US",
    pattern:
      /美|洛杉矶|硅谷|西雅图|芝加哥|纽约|US|United States|USA|LAX|SJC|SEA|ORD|EWR|IAD|DFW/i
  },
  { name: "TW", pattern: /台|台湾|新北|彰化|TW|Taiwan|TPE|KHH/i },
  { name: "SG", pattern: /新加坡|坡|狮城|SG|Singapore|SIN/i },
  { name: "KR", pattern: /韩|韓|首尔|KR|Korea|Seoul|ICN/i }
];

const RESERVED_ITEMS = ["DIRECT", "REJECT"];

const createRegionGroup = (name: string, proxies: string[]): ProxyGroupEntry => ({
  name,
  type: "select",
  proxies: proxies.length > 0 ? [...proxies, ...RESERVED_ITEMS] : [...RESERVED_ITEMS]
});

export const renderAutoGroups = (
  proxies: ProxyNode[],
  options: AutoGroupRenderOptions = {}
): AutoGroupRenderResult => {
  if (options.enabled === false) {
    return {
      groups: [],
      unclassifiedProxyNames: []
    };
  }

  const regionBuckets = new Map(REGION_MATCHERS.map((matcher) => [matcher.name, [] as string[]]));
  const unclassifiedProxyNames: string[] = [];
  const allProxyNames = proxies.map((proxy) => proxy.name).filter(Boolean);

  for (const proxyName of allProxyNames) {
    const matchedRegion = REGION_MATCHERS.find((matcher) => matcher.pattern.test(proxyName));

    if (matchedRegion) {
      regionBuckets.get(matchedRegion.name)?.push(proxyName);
      continue;
    }

    unclassifiedProxyNames.push(proxyName);
  }

  const regionGroups = REGION_MATCHERS.map((matcher) =>
    createRegionGroup(matcher.name, regionBuckets.get(matcher.name) ?? [])
  );
  const othersGroup =
    options.unclassifiedPolicy === "ignore"
      ? null
      : createRegionGroup("Others", unclassifiedProxyNames);
  const regionGroupNames = [
    ...REGION_MATCHERS.map((matcher) => matcher.name),
    ...(othersGroup ? [othersGroup.name] : [])
  ];
  const proxiesGroup: ProxyGroupEntry = {
    name: "Proxies",
    type: "select",
    proxies: [...regionGroupNames, ...allProxyNames, ...RESERVED_ITEMS]
  };
  const groups = [
    proxiesGroup,
    ...regionGroups,
    ...(othersGroup ? [othersGroup] : [])
  ];

  if (options.includeAutoGroup) {
    groups.push({
      name: "Auto",
      type: "url-test",
      proxies: allProxyNames,
      url: "https://www.gstatic.com/generate_204",
      interval: 300
    });
  }

  return {
    groups,
    unclassifiedProxyNames
  };
};
