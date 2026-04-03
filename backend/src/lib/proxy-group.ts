import type { ClashProxyDocument, ProxyGroupEntry } from "../types";

const regexps = {
  hk: /港|HK|hk|Hong Kong|HongKong|hongkong|HKG/i,
  jp: /日本|川日|东京|大阪|泉日|埼玉|沪日|深日|[^-]日|JP|Japan|Tokyo|NRT|KIX/i,
  us: /美|波特兰|达拉斯|俄勒冈|凤凰城|费利蒙|硅谷|拉斯维加斯|洛杉矶|圣何塞|圣克拉拉|西雅图|芝加哥|US|United States|ATL|BUF|DFW|EWR|IAD|LAX|MCI|MIA|ORD|PHX|PDX|SEA|SJC/i,
  tw: /台|新北|彰化|TW|Taiwan|TPE|KHH/i,
  sg: /新加坡|坡|狮城|SG|Singapore|SIN/i,
  kr: /KR|Korea|KOR|Seoul|首尔|春川|韩|韓|ICN/i
};

const genBasicGroups = (proxyGroupNames: string[]): ProxyGroupEntry[] => {
  return [
    {
      name: "🎯 全球直连",
      type: "select",
      proxies: ["DIRECT", ...proxyGroupNames, "REJECT"]
    },
    {
      name: "🛑 广告拦截",
      type: "select",
      proxies: ["REJECT", ...proxyGroupNames, "DIRECT"]
    },
    {
      name: "🍃 应用净化",
      type: "select",
      proxies: ["REJECT", ...proxyGroupNames, "DIRECT"]
    },
    {
      name: "🐟 漏网之鱼",
      type: "select",
      proxies: [...proxyGroupNames, "DIRECT", "REJECT"]
    }
  ];
};

const genAIGroups = (proxyGroupNames: string[]): ProxyGroupEntry[] => {
  return [
    {
      name: "🤖 LLMs",
      type: "select",
      proxies: [...proxyGroupNames]
    }
  ];
};

const genApplicationGroups = (
  proxyGroupNames: string[]
): ProxyGroupEntry[] => {
  return [
    {
      name: "🟦 BlueArchiveJP",
      type: "select",
      proxies: ["JP", proxyGroupNames[0] ?? "DIRECT", "DIRECT", "REJECT"]
    },
    {
      name: "♾️ 自定义代理",
      type: "select",
      proxies: [...proxyGroupNames, "DIRECT", "REJECT"]
    },
    {
      name: "📢 谷歌FCM",
      type: "select",
      proxies: [...proxyGroupNames, "DIRECT", "REJECT"]
    },
    {
      name: "Ⓜ️ 微软服务",
      type: "select",
      proxies: [...proxyGroupNames, "DIRECT", "REJECT"]
    },
    {
      name: "🍎 苹果服务",
      type: "select",
      proxies: [...proxyGroupNames, "DIRECT", "REJECT"]
    },
    {
      name: "📲 电报消息",
      type: "select",
      proxies: [...proxyGroupNames, "DIRECT", "REJECT"]
    },
    {
      name: "🎮 游戏平台",
      type: "select",
      proxies: [...proxyGroupNames, "DIRECT", "REJECT"]
    },
    {
      name: "📹 油管视频",
      type: "select",
      proxies: [...proxyGroupNames, "DIRECT", "REJECT"]
    },
    {
      name: "🎥 奈飞视频",
      type: "select",
      proxies: [...proxyGroupNames, "DIRECT", "REJECT"]
    },
    {
      name: "📺 巴哈姆特",
      type: "select",
      proxies: [...new Set(["TW", ...proxyGroupNames, "DIRECT", "REJECT"])]
    },
    {
      name: "📺 哔哩哔哩",
      type: "select",
      proxies: ["DIRECT", ...proxyGroupNames, "REJECT"]
    },
    {
      name: "🌏 国内媒体",
      type: "select",
      proxies: ["DIRECT", ...proxyGroupNames, "REJECT"]
    },
    {
      name: "🌍 国外媒体",
      type: "select",
      proxies: [...proxyGroupNames, "DIRECT", "REJECT"]
    }
  ];
};

const genGroupsByCountry = (proxy: ClashProxyDocument): ProxyGroupEntry[] => {
  return proxy.proxies.reduce<ProxyGroupEntry[]>(
    (groups, currentProxy) => {
      if (regexps.hk.test(currentProxy.name)) {
        groups[0].proxies.splice(-2, 0, currentProxy.name);
      } else if (regexps.jp.test(currentProxy.name)) {
        groups[1].proxies.splice(-2, 0, currentProxy.name);
      } else if (regexps.us.test(currentProxy.name)) {
        groups[2].proxies.splice(-2, 0, currentProxy.name);
      } else if (regexps.tw.test(currentProxy.name)) {
        groups[3].proxies.splice(-2, 0, currentProxy.name);
      } else if (regexps.sg.test(currentProxy.name)) {
        groups[4].proxies.splice(-2, 0, currentProxy.name);
      } else if (regexps.kr.test(currentProxy.name)) {
        groups[5].proxies.splice(-2, 0, currentProxy.name);
      } else {
        groups[6].proxies.splice(-2, 0, currentProxy.name);
      }

      return groups;
    },
    [
      { name: "HK", type: "select", proxies: ["DIRECT", "REJECT"] },
      { name: "JP", type: "select", proxies: ["DIRECT", "REJECT"] },
      { name: "US", type: "select", proxies: ["DIRECT", "REJECT"] },
      { name: "TW", type: "select", proxies: ["DIRECT", "REJECT"] },
      { name: "SG", type: "select", proxies: ["DIRECT", "REJECT"] },
      { name: "KR", type: "select", proxies: ["DIRECT", "REJECT"] },
      { name: "其他国家", type: "select", proxies: ["DIRECT", "REJECT"] }
    ]
  );
};

export const genGroups = (proxy: ClashProxyDocument): ProxyGroupEntry[] => {
  const proxyNames = proxy.proxies.map((item) => item.name);
  const sourceDefaultGroup = proxy["proxy-groups"][0];
  const defaultProxyGroup: ProxyGroupEntry = {
    ...(sourceDefaultGroup ?? {
      name: "🚀 节点选择",
      type: "select",
      proxies: proxyNames
    }),
    proxies: (sourceDefaultGroup?.proxies ?? proxyNames).filter((proxyName) =>
      proxyNames.includes(proxyName)
    )
  };

  defaultProxyGroup.proxies = [
    "HK",
    "JP",
    "US",
    "TW",
    "SG",
    "KR",
    "其他国家",
    ...defaultProxyGroup.proxies
  ];

  const groups = [defaultProxyGroup, ...genGroupsByCountry(proxy)];
  const groupNames = groups.map((group) => group.name);

  return [
    ...groups,
    ...genAIGroups(groupNames),
    ...genApplicationGroups(groupNames),
    ...genBasicGroups(groupNames)
  ];
};
