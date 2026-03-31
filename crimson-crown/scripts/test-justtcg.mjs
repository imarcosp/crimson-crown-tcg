import 'dotenv/config'
import axios from 'axios'

const API_KEY = process.env.JUSTTCG_API_KEY
async function main() {
  try {
    const res = await axios.get('https://api.justtcg.com/v1/cards', {
      params: { game: 'riftbound-league-of-legends-trading-card-game', page: 1, limit: 20 },
      headers: { 'X-API-Key': API_KEY },
      timeout: 20000,
      validateStatus: (s) => s >= 200 && s < 500,
    })
    console.log('Status:', res.status)
    console.log('Keys:', Object.keys(res.data || {}))
    console.log('Sample:', JSON.stringify(res.data?.data?.[0] || res.data?.[0] || res.data, null, 2))
  } catch (e) {
    console.error('Error:', e?.response?.status, e?.response?.data || e?.message)
  }
}

main()

