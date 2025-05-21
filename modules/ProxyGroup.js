const regexps = {
  hk: /港|HK|hk|Hong Kong|HongKong|hongkong|HKG/i,
  jp: /日本|川日|东京|大阪|泉日|埼玉|沪日|深日|[^-]日|JP|Japan|Tokyo|NRT|KIX/i,
  us: /美|波特兰|达拉斯|俄勒冈|凤凰城|费利蒙|硅谷|拉斯维加斯|洛杉矶|圣何塞|圣克拉拉|西雅图|芝加哥|US|United States|ATL|BUF|DFW|EWR|IAD|LAX|MCI|MIA|ORD|PHX|PDX|SEA|SJC/i,
  tw: /台|新北|彰化|TW|Taiwan|TPE|KHH/i,
  sg: /新加坡|坡|狮城|SG|Singapore|SIN/i,
  kr: /KR|Korea|KOR|Seoul|首尔|春川|韩|韓|ICN/i,
}
const genBasicGroups = proxyGroupName => {
  return [
    {
      name: '🎯 全球直连',
      type: 'select',
      proxies: ['DIRECT', ...proxyGroupName, 'REJECT'],
    },
    {
      name: '🛑 广告拦截',
      type: 'select',
      proxies: ['REJECT', ...proxyGroupName, 'DIRECT'],
    },
    {
      name: '🍃 应用净化',
      type: 'select',
      proxies: ['REJECT', ...proxyGroupName, 'DIRECT'],
    },
    {
      name: '🐟 漏网之鱼',
      type: 'select',
      proxies: [...proxyGroupName, 'DIRECT', 'REJECT'],
    },
  ]
}

const genAIGoups = proxyGroupName => {
  return [
    {
      name: '🤖 LLMs',
      type: 'select',
      proxies: ['Relay', ...proxyGroupName],
    },
  ]
}

const genApplicationGroups = proxyGroupName => {
  return [
    {
      name: '🟦 BlueArchiveJP',
      type: 'select',
      proxies: ['JP', proxyGroupName[0], 'DIRECT', 'REJECT'],
    },
    {
      name: '♾️ 自定义代理',
      type: 'select',
      proxies: [...proxyGroupName, 'DIRECT', 'REJECT'],
    },
    {
      name: '📢 谷歌FCM',
      type: 'select',
      proxies: [...proxyGroupName, 'DIRECT', 'REJECT'],
    },
    {
      name: 'Ⓜ️ 微软服务',
      type: 'select',
      proxies: [...proxyGroupName, 'DIRECT', 'REJECT'],
    },
    {
      name: '🍎 苹果服务',
      type: 'select',
      proxies: [...proxyGroupName, 'DIRECT', 'REJECT'],
    },
    {
      name: '📲 电报消息',
      type: 'select',
      proxies: [...proxyGroupName, 'DIRECT', 'REJECT'],
    },
    {
      name: '🎮 游戏平台',
      type: 'select',
      proxies: [...proxyGroupName, 'DIRECT', 'REJECT'],
    },
    // {
    //   name: '⬇️ 下载工具',
    //   type: 'select',
    //   proxies: [...proxyGroupName, 'DIRECT', 'REJECT'],
    // },
    {
      name: '📹 油管视频',
      type: 'select',
      proxies: [...proxyGroupName, 'DIRECT', 'REJECT'],
    },
    {
      name: '🎥 奈飞视频',
      type: 'select',
      proxies: [...proxyGroupName, 'DIRECT', 'REJECT'],
    },
    {
      name: '📺 巴哈姆特',
      type: 'select',
      proxies: [...new Set(['TW', ...proxyGroupName, 'DIRECT', 'REJECT'])],
    },
    {
      name: '📺 哔哩哔哩',
      type: 'select',
      proxies: ['DIRECT', ...proxyGroupName, 'REJECT'],
    },
    {
      name: '🌏 国内媒体',
      type: 'select',
      proxies: ['DIRECT', ...proxyGroupName, 'REJECT'],
    },
    {
      name: '🌍 国外媒体',
      type: 'select',
      proxies: [...proxyGroupName, 'DIRECT', 'REJECT'],
    },
  ]
}

const genGroupsByCountry = proxy => {
  const proxies = proxy.proxies
  return proxies.reduce(
    (itr, cur) => {
      if (regexps.hk.test(cur.name)) itr[0].proxies.splice(-2, 0, cur.name)
      else if (regexps.jp.test(cur.name)) itr[1].proxies.splice(-2, 0, cur.name)
      else if (regexps.us.test(cur.name)) itr[2].proxies.splice(-2, 0, cur.name)
      else if (regexps.tw.test(cur.name)) itr[3].proxies.splice(-2, 0, cur.name)
      else if (regexps.sg.test(cur.name)) itr[4].proxies.splice(-2, 0, cur.name)
      else if (regexps.kr.test(cur.name)) itr[5].proxies.splice(-2, 0, cur.name)
      else itr[6].proxies.splice(-2, 0, cur.name)
      return itr
    },
    [
      {
        name: 'HK',
        type: 'select',
        proxies: ['DIRECT', 'REJECT'],
      },
      {
        name: 'JP',
        type: 'select',
        proxies: ['DIRECT', 'REJECT'],
      },
      {
        name: 'US',
        type: 'select',
        proxies: ['DIRECT', 'REJECT'],
      },
      {
        name: 'TW',
        type: 'select',
        proxies: ['DIRECT', 'REJECT'],
      },
      {
        name: 'SG',
        type: 'select',
        proxies: ['DIRECT', 'REJECT'],
      },
      {
        name: 'KR',
        type: 'select',
        proxies: ['DIRECT', 'REJECT'],
      },
      {
        name: '其他国家',
        type: 'select',
        proxies: ['DIRECT', 'REJECT'],
      },
    ]
  )
}

const genGroups = proxy => {
  // 过滤原代理中已经不存在的节点或组
  const proxiesName = proxy.proxies.map(proxy => proxy.name)
  const defaultProxyGroup = proxy['proxy-groups'][0]

  defaultProxyGroup.proxies = defaultProxyGroup.proxies.filter(proxy =>
    proxiesName.includes(proxy)
  )
  defaultProxyGroup.proxies = [
    'HK',
    'JP',
    'US',
    'TW',
    'SG',
    'KR',
    '其他国家',
    ...defaultProxyGroup.proxies,
  ]

  const groups = [defaultProxyGroup]
  groups.push(...genGroupsByCountry(proxy))
  const groupsName = groups.map(group => group.name)
  const AIGroups = genAIGoups(groupsName)
  const applicationGroups = genApplicationGroups(groupsName)
  const basicGroups = genBasicGroups(groupsName)
  return [...groups, ...AIGroups, ...applicationGroups, ...basicGroups]
}

module.exports = {
  genGroups,
}
