// 地区推断：仅用于展示徽章与地区组生成，绝不写回节点数据（技术方案 §6.1）。
// 识别分两层，先命中者优先：
//   1. 旗帜 emoji 解码（两个「区域指示符号」字符 → ISO 3166-1 alpha-2），覆盖面最广、误判率最低；
//   2. 关键字正则兜底（中文名 / 英文名 / 常见机场三字码），覆盖旗帜识别不到的纯文字命名。
// 覆盖全球约 50 个最常见于机场订阅命名的国家/地区；纯尽力而为，识别不到时用户可在节点页手动指定。

export const REGION_CODES = [
  "HK", "TW", "JP", "US", "SG", "KR",
  "GB", "DE", "FR", "NL", "RU", "IN", "CA", "AU", "BR", "AR",
  "TR", "AE", "IL", "ZA", "IT", "ES", "SE", "CH", "PL", "UA",
  "VN", "TH", "MY", "PH", "ID", "MO", "PT", "IE", "NO", "DK",
  "FI", "BE", "AT", "GR", "CZ", "HU", "RO", "MX", "CL", "EG",
  "SA", "QA", "PK", "NZ", "LU", "KH", "LA", "MN", "MM"
] as const;
export type RegionCode = (typeof REGION_CODES)[number];

// 关键字正则兜底表：中文名 + 英文名 + 常见机场三字码，均不加 \b（中文非 \w，加了无效）；
// 纯英文字母/代码类关键词加 \b 词边界，避免命中长单词内部子串（如 "Australia" 内含 "us"）。
const REGION_MATCHERS: Array<{ code: RegionCode; pattern: RegExp }> = [
  { code: "HK", pattern: /港|香港|\bHK\b|Hong ?Kong|\bHKG\b/i },
  { code: "TW", pattern: /台|台湾|臺灣|新北|彰化|\bTW\b|Taiwan|\bTPE\b|\bKHH\b/i },
  { code: "JP", pattern: /日本|东京|東京|大阪|\bJP\b|Japan|\bNRT\b|\bKIX\b|\bHND\b/i },
  { code: "KR", pattern: /韩|韓|首尔|首爾|\bKR\b|Korea|Seoul|\bICN\b/i },
  { code: "SG", pattern: /新加坡|坡|狮城|獅城|\bSG\b|Singapore|\bSIN\b/i },
  {
    code: "US",
    pattern:
      /美|美国|美國|洛杉矶|洛杉磯|硅谷|西雅图|西雅圖|芝加哥|纽约|紐約|\bUS\b|United States|\bUSA\b|\bLAX\b|\bSJC\b|\bSEA\b|\bORD\b|\bEWR\b|\bIAD\b|\bDFW\b/i
  },
  { code: "GB", pattern: /英国|英國|伦敦|倫敦|\bUK\b|\bGB\b|United Kingdom|Britain|London|\bLHR\b/i },
  { code: "DE", pattern: /德国|德國|法兰克福|法蘭克福|柏林|\bDE\b|Germany|Frankfurt|Berlin|\bFRA\b/i },
  { code: "FR", pattern: /法国|法國|巴黎|\bFR\b|France|Paris|\bCDG\b/i },
  { code: "NL", pattern: /荷兰|荷蘭|阿姆斯特丹|\bNL\b|Netherlands|Amsterdam|\bAMS\b/i },
  { code: "RU", pattern: /俄罗斯|俄羅斯|俄国|俄國|莫斯科|\bRU\b|Russia|Moscow|\bSVO\b/i },
  { code: "IN", pattern: /印度|孟买|孟買|新德里|\bIN\b|India|Mumbai|Delhi|\bBOM\b|\bDEL\b/i },
  { code: "CA", pattern: /加拿大|多伦多|多倫多|温哥华|溫哥華|\bCA\b|Canada|Toronto|Vancouver|\bYYZ\b/i },
  { code: "AU", pattern: /澳大利亚|澳大利亞|澳洲|悉尼|墨尔本|墨爾本|\bAU\b|Australia|Sydney|Melbourne|\bSYD\b/i },
  { code: "BR", pattern: /巴西|圣保罗|聖保羅|\bBR\b|Brazil|Sao Paulo|São Paulo|\bGRU\b/i },
  { code: "AR", pattern: /阿根廷|布宜诺斯艾利斯|布宜諾斯艾利斯|\bAR\b|Argentina|Buenos Aires/i },
  { code: "TR", pattern: /土耳其|伊斯坦布尔|伊斯坦布爾|\bTR\b|Turkey|Turkiye|Türkiye|Istanbul|\bIST\b/i },
  { code: "AE", pattern: /阿联酋|阿聯酋|迪拜|迪拜哈利法|\bAE\b|UAE|Dubai|Abu Dhabi|\bDXB\b/i },
  { code: "IL", pattern: /以色列|特拉维夫|特拉維夫|\bIL\b|Israel|Tel ?Aviv/i },
  { code: "ZA", pattern: /南非|约翰内斯堡|約翰內斯堡|\bZA\b|South Africa|Johannesburg/i },
  { code: "IT", pattern: /意大利|義大利|米兰|米蘭|罗马|羅馬|\bIT\b|Italy|Milan|Rome/i },
  { code: "ES", pattern: /西班牙|马德里|馬德里|\bES\b|Spain|Madrid/i },
  { code: "SE", pattern: /瑞典|斯德哥尔摩|斯德哥爾摩|\bSE\b|Sweden|Stockholm/i },
  { code: "CH", pattern: /瑞士|苏黎世|蘇黎世|\bCH\b|Switzerland|Zurich|Zürich/i },
  { code: "PL", pattern: /波兰|波蘭|华沙|華沙|\bPL\b|Poland|Warsaw/i },
  { code: "UA", pattern: /乌克兰|烏克蘭|基辅|基輔|\bUA\b|Ukraine|Kyiv|Kiev/i },
  { code: "VN", pattern: /越南|河内|河內|胡志明|\bVN\b|Vietnam|Hanoi/i },
  { code: "TH", pattern: /泰国|泰國|曼谷|\bTH\b|Thailand|Bangkok|\bBKK\b/i },
  { code: "MY", pattern: /马来西亚|馬來西亞|吉隆坡|\bMY\b|Malaysia|Kuala ?Lumpur|\bKUL\b/i },
  { code: "PH", pattern: /菲律宾|菲律賓|马尼拉|馬尼拉|\bPH\b|Philippines|Manila/i },
  { code: "ID", pattern: /印尼|印度尼西亚|印度尼西亞|雅加达|雅加達|\bID\b|Indonesia|Jakarta/i },
  { code: "MO", pattern: /澳门|澳門|\bMO\b|Macau|Macao/i },
  { code: "PT", pattern: /葡萄牙|里斯本|\bPT\b|Portugal|Lisbon/i },
  { code: "IE", pattern: /爱尔兰|愛爾蘭|都柏林|\bIE\b|Ireland|Dublin/i },
  { code: "NO", pattern: /挪威|奥斯陆|奧斯陸|\bNO\b|Norway|Oslo/i },
  { code: "DK", pattern: /丹麦|丹麥|哥本哈根|\bDK\b|Denmark|Copenhagen/i },
  { code: "FI", pattern: /芬兰|芬蘭|赫尔辛基|赫爾辛基|\bFI\b|Finland|Helsinki/i },
  { code: "BE", pattern: /比利时|比利時|布鲁塞尔|布魯塞爾|\bBE\b|Belgium|Brussels/i },
  { code: "AT", pattern: /奥地利|奧地利|维也纳|維也納|\bAT\b|Austria|Vienna/i },
  { code: "GR", pattern: /希腊|希臘|雅典|\bGR\b|Greece|Athens/i },
  { code: "CZ", pattern: /捷克|布拉格|\bCZ\b|Czech|Prague/i },
  { code: "HU", pattern: /匈牙利|布达佩斯|布達佩斯|\bHU\b|Hungary|Budapest/i },
  { code: "RO", pattern: /罗马尼亚|羅馬尼亞|布加勒斯特|\bRO\b|Romania|Bucharest/i },
  { code: "MX", pattern: /墨西哥|\bMX\b|Mexico/i },
  { code: "CL", pattern: /智利|圣地亚哥|聖地牙哥|\bCL\b|Chile|Santiago/i },
  { code: "EG", pattern: /埃及|开罗|開羅|\bEG\b|Egypt|Cairo/i },
  { code: "SA", pattern: /沙特|利雅得|\bSA\b|Saudi|Riyadh/i },
  { code: "QA", pattern: /卡塔尔|卡塔爾|多哈|\bQA\b|Qatar|Doha/i },
  { code: "PK", pattern: /巴基斯坦|伊斯兰堡|伊斯蘭堡|\bPK\b|Pakistan/i },
  { code: "NZ", pattern: /新西兰|新西蘭|纽西兰|紐西蘭|奥克兰|奧克蘭|\bNZ\b|New Zealand|Auckland/i },
  { code: "LU", pattern: /卢森堡|盧森堡|\bLU\b|Luxembourg/i },
  { code: "KH", pattern: /柬埔寨|金边|金邊|\bKH\b|Cambodia|Phnom Penh/i },
  { code: "LA", pattern: /老挝|老撾|万象|萬象|\bLAO\b|Laos/i },
  { code: "MN", pattern: /蒙古|乌兰巴托|烏蘭巴托|\bMN\b|Mongolia/i },
  { code: "MM", pattern: /缅甸|緬甸|仰光|\bMM\b|Myanmar|Yangon/i }
];

// 旗帜 emoji：一对「区域指示符号」（U+1F1E6..U+1F1FF）对应 ISO 3166-1 alpha-2 两个字母。
const REGIONAL_INDICATOR_BASE = 0x1f1e6; // 对应字母 'A'

const decodeFlagEmoji = (name: string): string | null => {
  const chars = Array.from(name); // 按码点切分，正确处理代理对
  for (let i = 0; i < chars.length - 1; i++) {
    const a = chars[i]!.codePointAt(0) ?? 0;
    const b = chars[i + 1]!.codePointAt(0) ?? 0;
    const isIndicator = (code: number) => code >= REGIONAL_INDICATOR_BASE && code <= REGIONAL_INDICATOR_BASE + 25;
    if (isIndicator(a) && isIndicator(b)) {
      const letter1 = String.fromCharCode(65 + (a - REGIONAL_INDICATOR_BASE));
      const letter2 = String.fromCharCode(65 + (b - REGIONAL_INDICATOR_BASE));
      return letter1 + letter2;
    }
  }
  return null;
};

export const isRegionCode = (value: string): value is RegionCode =>
  (REGION_CODES as readonly string[]).includes(value);

export const detectRegion = (name: string): RegionCode | null => {
  const flagCode = decodeFlagEmoji(name);
  if (flagCode && isRegionCode(flagCode)) {
    return flagCode as RegionCode;
  }
  for (const matcher of REGION_MATCHERS) {
    if (matcher.pattern.test(name)) {
      return matcher.code;
    }
  }
  return null;
};
