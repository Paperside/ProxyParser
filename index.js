const proxyRouter = require('./controllers/proxy')
const express = require('express')

async function initializeApp() {
  const app = express()

  // Routers
  app.use('/api/proxy', proxyRouter)

  // Main Thread
  const PORT = 3001
  app.listen(PORT, () => {
    console.log(`server running on port ${PORT}`)
  })
}

initializeApp().catch(err => {
  console.error('Initialization failed', err)
  process.exit(1)
})
