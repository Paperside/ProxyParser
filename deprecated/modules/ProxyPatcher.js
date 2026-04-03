const { fetchSubscriptionByUrl } = require('../fetch/FetchSubscription')
const { parseProxyWithString } = require('./ProxyContent')
const { genGroups } = require('./ProxyGroup')
const { getFullRules } = require('./ProxyRules')

/**
 * TODO:
 * Parse and Patch valid subscription correctly
 */
const getPatchedProxy = async url => {
  const res = await fetchSubscriptionByUrl(url)
  if (res.status === 'success') {
    res.data = parseProxyWithString(res.data)
    if (res.data) {
      const rules = await getFullRules()
      res.data.rules = rules
      res.data['proxy-groups'] = genGroups(res.data)
    }
  }
  return res
}

/**
 * TODO:
 * Fetch all proxies provided
 * Merge proxies into a resMap
 */
const getPatchedProxyAll = async urlMap => {
  const resMap = new Map()
  for (const [name, url] of urlMap) {
    const res = await getPatchedProxy(url)
    resMap.set(name, res)
  }
  return resMap
}

module.exports = {
  getPatchedProxy,
  getPatchedProxyAll,
}
