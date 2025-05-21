const staticResidentProxy = {
  name: '🇺🇸 United States | CA | ResidentIP',
  server: '38.15.20.141',
  port: 443,
  type: 'socks5',
  username: 'mE9L55221',
  password: 'jmedhsWo',
}

const relayProxyGroup = {
  name: 'Relay',
  type: 'relay',
  proxies: ['🇺🇸 United States | CA | ResidentIP'],
}

const patchRelay = proxy => {
  if (Object.prototype.toString.call(proxy.proxies) === '[object Array]') {
    // Patch proxy
    proxy.proxies.push(staticResidentProxy)

    // Patch group
    proxy['proxy-groups'].push({
      ...relayProxyGroup,
      proxies: [proxy['proxy-groups'][0].name, ...relayProxyGroup.proxies],
    })

    return proxy
  } else {
    throw new Error(
      `Object type not correct: ${Object.prototype.toString.call(
        proxy.proxies
      )}`
    )
  }
}

module.exports = {
  patchRelay,
}
