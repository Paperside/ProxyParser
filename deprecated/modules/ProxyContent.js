const yaml = require('js-yaml')
const fs = require('fs')

const parseProxyWithLocalFile = (filePath, encoding = 'utf-8') => {
  try {
    const doc = yaml.load(fs.readFileSync(filePath, encoding))
    return doc
  } catch (e) {
    console.error(e)
    return null
  }
}

const parseProxyWithString = yamlStr => {
  try {
    const res = yaml.load(yamlStr)
    return res
  } catch (e) {
    console.log(e)
    return null
  }
}

const dumpProxy = (proxy, filePath, encoding = 'utf-8') => {
  try {
    const yamlString = yaml.dump(proxy, {})
    fs.writeFileSync(filePath, yamlString, { encoding })
  } catch (e) {
    console.error(e)
    return null
  }
}

module.exports = {
  parseProxyWithLocalFile,
  parseProxyWithString,
  dumpProxy,
}
