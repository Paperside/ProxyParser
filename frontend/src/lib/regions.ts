// 地区码 + 中文显示名，手动与后端 backend/src/lib/render-v2/region.ts 的 REGION_CODES 保持同步
// （同 BUILTIN_POLICY_OPTIONS 的维护方式：改一处记得改另一处）。

export const REGION_LABELS: Record<string, string> = {
  HK: "香港",
  TW: "台湾",
  JP: "日本",
  US: "美国",
  SG: "新加坡",
  KR: "韩国",
  GB: "英国",
  DE: "德国",
  FR: "法国",
  NL: "荷兰",
  RU: "俄罗斯",
  IN: "印度",
  CA: "加拿大",
  AU: "澳大利亚",
  BR: "巴西",
  AR: "阿根廷",
  TR: "土耳其",
  AE: "阿联酋",
  IL: "以色列",
  ZA: "南非",
  IT: "意大利",
  ES: "西班牙",
  SE: "瑞典",
  CH: "瑞士",
  PL: "波兰",
  UA: "乌克兰",
  VN: "越南",
  TH: "泰国",
  MY: "马来西亚",
  PH: "菲律宾",
  ID: "印尼",
  MO: "澳门",
  PT: "葡萄牙",
  IE: "爱尔兰",
  NO: "挪威",
  DK: "丹麦",
  FI: "芬兰",
  BE: "比利时",
  AT: "奥地利",
  GR: "希腊",
  CZ: "捷克",
  HU: "匈牙利",
  RO: "罗马尼亚",
  MX: "墨西哥",
  CL: "智利",
  EG: "埃及",
  SA: "沙特",
  QA: "卡塔尔",
  PK: "巴基斯坦",
  NZ: "新西兰",
  LU: "卢森堡",
  KH: "柬埔寨",
  LA: "老挝",
  MN: "蒙古",
  MM: "缅甸"
};

export const REGION_CODES = Object.keys(REGION_LABELS);

export const regionLabel = (code: string): string => {
  const label = REGION_LABELS[code];
  return label ? `${code} · ${label}` : code;
};
