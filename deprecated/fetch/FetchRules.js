const axios = require('axios')

const fetchRulesByURL = async url => {
  console.info(`fetching ${url}`)
  const res = await axios.get(url)
  const data = res.data
  if (typeof data !== 'string') {
    throw new Error('Requested rule data type incorrect.')
  }
  return data.split('\n').reduce((itr, rule) => {
    rule = rule.replaceAll(/(\n|\r|\r\n|↵)/g, '')
    if (
      rule.length !== 0 &&
      !(
        rule.startsWith('#') ||
        rule.startsWith('USER-AGENT') ||
        rule.startsWith('URL-REGEX')
      )
    )
      return itr.concat(rule)
    else return itr
  }, [])
}

module.exports = {
  fetchRulesByURL,
}
