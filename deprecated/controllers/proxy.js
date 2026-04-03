const proxyRouter = require('express').Router()
const { getFullRules } = require('../modules/ProxyRules')
const { subscriptions } = require('../config')
const {
  getPatchedProxy,
  getPatchedProxyAll,
} = require('../modules/ProxyPatcher')

;(async function initializeProxy() {
  // Raw subscription url map
  const urlMap = new Map()
  subscriptions.forEach(({ name, url }) => {
    urlMap.set(name, url)
  })

  // Operations on proxy
  let proxies = await getPatchedProxyAll(urlMap)

  // Routers
  proxyRouter.get('/', async (req, res) => {
    proxies = await getPatchedProxyAll(urlMap)
    const body = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Document</title>
        </head>
        <body>
          <h1>Proxy Status</h1>
          <p>Total Proxies: ${proxies.size}</p>
          <table>
            <thead>
              <th>Name</th>
              <th>Status</th>
              <th>LastModified</th>
            </thead>
            <tbody>
                ${[...proxies]
                  .map(
                    data =>
                      `<tr><td>${data[0]}</td>
                    <td>${data[1].status}</td>
                    <td>${data[1].lastModified.toString()}</td></tr>`
                  )
                  .join('')}
            </tbody>
          </table>
        </body>
        </html>
      `
    res.set('Content-Type', 'text/html')
    res.status(200).send(body)
  })

  proxyRouter.get('/:name', async (req, res) => {
    // Check if name exists
    const name = req.params.name
    if (!proxies.has(name)) {
      res.status(404).json({ msg: `No such proxy name: ${name}` })
      return
    }

    // Check proxy status and update if needed
    let currentProxy = proxies.get(name)
    if (
      currentProxy.status === 'failed' ||
      currentProxy.lastModified - new Date() >= 60 * 60 * 24 * 1000
    ) {
      const updatedProxy = await getPatchedProxy(urlMap.get(name))
      proxies.set(name, updatedProxy)
      currentProxy = updatedProxy
      if (updatedProxy.status === 'failed') {
        res.status(503).json({
          msg: `Proxy: ${name} failed`,
          ...updatedProxy,
        })
        return
      }
    }

    // Response with related info
    res.set({
      ...currentProxy.headers,
      'Content-Type': 'application/json',
    })
    res.json(currentProxy.data)
  })

  proxyRouter.get('/rules', async (req, res) => {
    const rules = await getFullRules()
    res.json(rules)
  })
})()

module.exports = proxyRouter
