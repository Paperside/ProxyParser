// 地区推断：仅用于展示徽章与地区组生成，绝不写回节点数据（技术方案 §6.1）。
// 正则沿用 V1 auto-groups 的成熟集合。

export const REGION_CODES = ["HK", "TW", "JP", "US", "SG", "KR"] as const;
export type RegionCode = (typeof REGION_CODES)[number];

const REGION_MATCHERS: Array<{ code: RegionCode; pattern: RegExp }> = [
  { code: "HK", pattern: /港|HK|Hong ?Kong|HKG/i },
  { code: "TW", pattern: /台|台湾|新北|彰化|TW|Taiwan|TPE|KHH/i },
  { code: "JP", pattern: /日本|东京|大阪|JP|Japan|Tokyo|NRT|KIX/i },
  {
    code: "US",
    pattern:
      /美|洛杉矶|硅谷|西雅图|芝加哥|纽约|US|United States|USA|LAX|SJC|SEA|ORD|EWR|IAD|DFW/i
  },
  { code: "SG", pattern: /新加坡|坡|狮城|SG|Singapore|SIN/i },
  { code: "KR", pattern: /韩|韓|首尔|KR|Korea|Seoul|ICN/i }
];

export const detectRegion = (name: string): RegionCode | null => {
  for (const matcher of REGION_MATCHERS) {
    if (matcher.pattern.test(name)) {
      return matcher.code;
    }
  }
  return null;
};

export const isRegionCode = (value: string): value is RegionCode =>
  (REGION_CODES as readonly string[]).includes(value);
