const staticResidentProxy = {
  name: '🇺🇸 United States | CA | ResidentIP',
  server: '38.15.20.141',
  port: 2024,
  type: 'socks5',
  username: 'mE9L55221',
  password: 'jmedhsWo',
}

const llmRules = [
  'DOMAIN,challenges.cloudflare.com,OpenAI',
  'DOMAIN,events.statsigapi.net,OpenAI',
  'DOMAIN,featuregates.org,OpenAI',
  'DOMAIN,o33249.ingest.sentry.io,OpenAI',
  'DOMAIN,openaiapi-site.azureedge.net,OpenAI',
  'DOMAIN-SUFFIX,ai.com,OpenAI',
  'DOMAIN-SUFFIX,auth0.com,OpenAI',
  'DOMAIN-SUFFIX,chatgpt.com,OpenAI',
  'DOMAIN-SUFFIX,identrust.com,OpenAI',
  'DOMAIN-SUFFIX,intercom.io,OpenAI',
  'DOMAIN-SUFFIX,oaistatic.com,OpenAI',
  'DOMAIN-SUFFIX,oaiusercontent.com,OpenAI',
  'DOMAIN-SUFFIX,openai.com,OpenAI',
  'DOMAIN,cdn.usefathom.com,Anthropic',
  'DOMAIN-SUFFIX,anthropic.com,Anthropic',
  'DOMAIN-SUFFIX,claude.ai,Anthropic',
  'DOMAIN-SUFFIX,claudeusercontent.com,Anthropic',
]

const proxiesPatcher = proxies => {
  if (Object.prototype.toString.call(proxies) !== '[object Array]')
    throw new Error(`proxies format error!, content:${proxies}`)
  proxies = proxies.reduce(
    (itr, cur) => {
      if (cur.name !== staticResidentProxy.name) {
        itr.splice(-1, 0, cur)
      }
      return itr
    },
    [staticResidentProxy]
  )
  return proxies
}

const relayProxyGroupPatcher = (proxyGroup, relayProxyGroup) => {
  if (Object.prototype.toString.call(proxyGroup) !== '[object Array]')
    throw new Error(`proxy group format error!, content:${proxyGroup}`)
  proxyGroup.splice(1, 0, relayProxyGroup)
  return proxyGroup
}

const proxyGroupsPatcher = (proxyGroup, llmProxyGroup) => {
  if (Object.prototype.toString.call(proxyGroup) !== '[object Array]')
    throw new Error(`proxy group format error!, content:${proxyGroup}`)
  proxyGroup = proxyGroup.reduce(
    (itr, cur) => {
      const curNameLowerCase = cur.name.toLowerCase()
      if (curNameLowerCase === 'openai' || curNameLowerCase === 'chatgpt') {
        const patchedCur = {
          name: 'OpenAI',
          type: 'select',
          proxies: ['Relay', ...cur.proxies],
        }
        itr.splice(-1, 0, patchedCur)
        itr[itr.length - 1] = itr[itr.length - 1].filter(
          pg => pg.name !== 'OpenAI'
        )
      } else if (
        curNameLowerCase === 'anthropic' ||
        curNameLowerCase === 'claude'
      ) {
        const patchedCur = {
          name: 'Anthropic',
          type: 'select',
          proxies: ['Relay', ...cur.proxies],
        }
        itr.splice(-1, 0, patchedCur)
        itr[itr.length - 1] = itr[itr.length - 1].filter(
          pg => pg.name !== 'Anthropic'
        )
      } else {
        itr.splice(-1, 0, cur)
      }
      return itr
    },
    [llmProxyGroup]
  )
  const appendGroups = proxyGroup.at(-1)
  proxyGroup.pop()
  if (appendGroups.length !== 0) proxyGroup.push(...appendGroups)
  return proxyGroup
}

const rulesPatcher = rules => {
  if (Object.prototype.toString.call(rules) !== '[object Array]')
    throw new Error(`rules format error!, content:${rules}`)
  rules = llmRules.concat(rules)
  return rules
}

const ProxyPatcher = proxy => {
  const mainProxyGroup = proxy['proxy-groups'][0]
  const relayProxyGroup = {
    name: 'Relay',
    type: 'relay',
    proxies: [mainProxyGroup.name, '🇺🇸 United States | CA | ResidentIP'],
  }
  const llmProxyGroup = [
    {
      name: 'OpenAI',
      type: 'select',
      proxies: ['Relay', mainProxyGroup.name],
    },
    {
      name: 'Anthropic',
      type: 'select',
      proxies: ['Relay', mainProxyGroup.name],
    },
  ]

  try {
    // Patch proxies
    proxy.proxies = proxiesPatcher(proxy.proxies)
    // Patch relay
    proxy['proxy-groups'] = relayProxyGroupPatcher(
      proxy['proxy-groups'],
      relayProxyGroup
    )
    // Patch proxy-groups
    proxy['proxy-groups'] = proxyGroupsPatcher(
      proxy['proxy-groups'],
      llmProxyGroup
    )
    // Patch rules
    proxy.rules = rulesPatcher(proxy.rules)
  } catch (e) {
    console.error(e)
  }
  return proxy
}

module.exports = {
  ProxyPatcher,
}
