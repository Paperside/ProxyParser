const axios = require('axios')

/** TODO
 * Fecth urls provided with proper UA
 * Parse subscription info as yaml(usually already is)
 * Keep crucial response head
 * Return coresponding data
 * */
const fetchSubscriptionByUrl = async url => {
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'clash-verge/v1.6.6',
      },
    })
    return {
      status: 'success',
      data: res.data,
      headers: res.headers,
      lastModified: new Date(),
    }
  } catch (e) {
    console.log(e)
    return {
      status: 'failed',
      errMsg: String(e),
      lastModified: new Date(),
    }
  }
}

module.exports = {
  fetchSubscriptionByUrl,
}
