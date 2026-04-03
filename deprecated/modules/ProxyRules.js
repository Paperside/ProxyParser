const { fetchRulesByURL } = require('../fetch/FetchRules')
const fs = require('fs')

const localRulesPath = './rules.json'
const rulesMap = new Map()

const setRules = () => {
  // Custom rules
  rulesMap.set('🤖 LLMs', [
    'DOMAIN,challenges.cloudflare.com',
    'DOMAIN,events.statsigapi.net',
    'DOMAIN,featuregates.org',
    'DOMAIN,o33249.ingest.sentry.io',
    'DOMAIN,openaiapi-site.azureedge.net',
    'DOMAIN-SUFFIX,ai.com',
    'DOMAIN-SUFFIX,auth0.com',
    'DOMAIN-SUFFIX,chatgpt.com',
    'DOMAIN-SUFFIX,identrust.com',
    'DOMAIN-SUFFIX,intercom.io',
    'DOMAIN-SUFFIX,oaistatic.com',
    'DOMAIN-SUFFIX,oaiusercontent.com',
    'DOMAIN-SUFFIX,openai.com',
    'DOMAIN,cdn.usefathom.com',
    'DOMAIN-SUFFIX,anthropic.com',
    'DOMAIN-SUFFIX,claude.ai',
    'DOMAIN-SUFFIX,claudeusercontent.com',
  ])

  rulesMap.set('🟦 BlueArchiveJP', [
    'IP-CIDR,13.113.125.63/32',
    'DOMAIN-SUFFIX,aliyun.com',
    'DOMAIN-SUFFIX,aliyuncs.com',
    'DOMAIN-SUFFIX,bluearchive.jp',
    'DOMAIN-SUFFIX,bluearchiveyostar.com',
    'DOMAIN-SUFFIX,yostar.net',
  ])

  rulesMap.set('♾️ 自定义代理', [
    'DOMAIN-SUFFIX,udemycdn.com',
    'DOMAIN-SUFFIX,udemy.com',
    'DOMAIN-SUFFIX,branch.io',
    'DOMAIN-SUFFIX,ads-twitter.com',
    'DOMAIN-SUFFIX,pointmediatracker.com',
    'DOMAIN-SUFFIX,criteo.com',
  ])

  // Rule Providers
  rulesMap.set('📢 谷歌FCM', [
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/GoogleFCM.list',
  ])

  rulesMap.set('Ⓜ️ 微软服务', [
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Bing.list',
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/OneDrive.list',
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Microsoft.list',
  ])

  // 过于严格，暂不使用了
  // rulesMap.set('🤖 OpenAi', [
  //   'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/OpenAi.list',
  //   'https://raw.githubusercontent.com/juewuy/ShellClash/master/rules/ai.list',
  //   'https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/Copilot.list',
  //   'https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/GithubCopilot.list',
  //   'https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/Claude.list',
  // ])

  rulesMap.set('🍎 苹果服务', [
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Apple.list',
  ])

  rulesMap.set('📲 电报消息', [
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Telegram.list',
  ])

  rulesMap.set('🎮 游戏平台', [
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Epic.list',
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Origin.list',
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Sony.list',
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Steam.list',
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Nintendo.list',
  ])

  // rulesMap.set('⬇️ 下载工具', [
  //   'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Download.list',
  // ])

  rulesMap.set('📹 油管视频', [
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/YouTube.list',
  ])

  rulesMap.set('🎥 奈飞视频', [
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Netflix.list',
  ])

  rulesMap.set('📺 巴哈姆特', [
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Bahamut.list',
  ])

  rulesMap.set('📺 哔哩哔哩', [
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/BilibiliHMT.list',
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Bilibili.list',
  ])

  rulesMap.set('🌏 国内媒体', [
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaMedia.list',
  ])

  rulesMap.set('🌍 国外媒体', [
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ProxyMedia.list',
    'https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/Emby.list',
  ])

  rulesMap.set('🎯 全球直连', [
    'https://raw.githubusercontent.com/cmliu/ACL4SSR/refs/heads/main/Clash/CFnat.list',
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/LocalAreaNetwork.list',
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/UnBan.list',
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/GoogleCN.list',
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/SteamCN.list',
    'https://raw.githubusercontent.com/UlinoyaPed/ShellClash/dev/lists/direct.list',
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaDomain.list',
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaCompanyIp.list',
    'GEOIP,CN',
  ])

  rulesMap.set('🛑 广告拦截', [
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanAD.list',
  ])

  rulesMap.set('🍃 应用净化', [
    'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanProgramAD.list',
    'https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/adobe.list',
  ])

  // FINAL
  rulesMap.set('🐟 漏网之鱼', ['MATCH'])
}

const updateRules = async () => {
  setRules()
  const rulesArray = []
  for (let [key, value] of rulesMap.entries()) {
    const result = []
    for (let item of value) {
      if (item.startsWith('http')) {
        try {
          const rules = (await fetchRulesByURL(item)).map(rule => {
            const ruleParams = rule.split(',')
            if (ruleParams.at(-1).includes('no-resolve'))
              ruleParams.splice(-1, 0, key)
            else ruleParams.push(key)
            return ruleParams.join(',')
          })
          result.push(...rules)
        } catch (e) {
          console.error('Error in fetching data...\n', e)
        }
      } else {
        result.push(item.concat(`,${key}`))
      }
    }
    rulesArray.push(...result)
  }

  try {
    fs.writeFileSync(localRulesPath, JSON.stringify(rulesArray, null, 2))
    console.log(`Rules saved to ${localRulesPath}`)
  } catch (e) {
    console.error('Error saving rules to file...\n', e)
  }
  return rulesArray
}

const extractRules = filePath => {
  try {
    const data = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(data)
  } catch (e) {
    console.error('Error reading rules from file...\n', e)
    return []
  }
}

const getFullRules = async (filePath = localRulesPath) => {
  if (fs.existsSync(filePath)) {
    return extractRules(filePath)
  } else {
    return await updateRules()
  }
}
module.exports = {
  updateRules,
  extractRules,
  getFullRules,
}
