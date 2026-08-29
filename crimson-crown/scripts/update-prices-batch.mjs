import 'dotenv/config'
import axios from 'axios'
import { load as cheerioLoad } from 'cheerio'
import { createOperationalSupabaseClient as createClient } from './lib/guarded-supabase-client.mjs'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Falta env: NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

function normalizeName(name) {
  try {
    return String(name || '')
      .toLowerCase()
      .replace(/\[[^\]]*\]/g, '') // remove bracketed tags like [Alternate Art]
      .replace(/#\s*\d+[a-z]?/gi, '') // remove collector numbers like #66, #120a
      .replace(/[–—-]+/g, ' ') // dashes to space
      .replace(/[,]+/g, ' ') // commas to space
      .replace(/\s+/g, ' ') // collapse whitespace
      .trim()
  } catch {
    return ''
  }
}

function parseDollar(text) {
  const m = String(text || '').match(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+(?:\.[0-9]{2})?)/)
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

async function fetchPriceTable() {
  const url = 'https://www.pricecharting.com/console/riftbound-origins'
  console.log('⬇️  Descargando lista de precios:', url)
  const { data: html } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    },
    timeout: 30000,
    validateStatus: (s) => s >= 200 && s < 400,
  })
  const $ = cheerioLoad(html)
  const map = new Map()

  const rows = $('table tr')
  rows.each((_, tr) => {
    const $tr = $(tr)
    const a = $tr.find('a').first()
    const nameText = a.text().trim()
    if (!nameText) return
    // pick first price-like cell in the row (Ungraded column)
    let price = null
    $tr.find('td').each((__, td) => {
      if (price != null) return
      const p = parseDollar($(td).text())
      if (p != null) price = p
    })
    if (price == null) return
    const norm = normalizeName(nameText)
    if (norm) {
      map.set(norm, price)
    }
  })

  console.log(`🧮 Precios parseados: ${map.size}`)
  return map
}

async function fetchAllRiftbound() {
  const PAGE_SIZE = 1000
  let from = 0
  let fetchMore = true
  const all = []
  while (fetchMore) {
    const { data, error } = await supabase
      .from('products')
      .select('id, inventory_id, name, set_name, collector_number, price_usd, tcg, is_manual_price')
      .eq('tcg', 'Riftbound')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (data && data.length > 0) {
      all.push(...data)
      if (data.length < PAGE_SIZE) fetchMore = false
      else from += PAGE_SIZE
    } else fetchMore = false
  }
  console.log(`📦 Productos Riftbound: ${all.length}`)
  return all
}

async function main() {
  try {
    const priceMap = await fetchPriceTable()
    const products = await fetchAllRiftbound()

    let updated = 0
    let matched = 0
    const examples = []

    // Prepare keys for fuzzy matching
    const keys = Array.from(priceMap.keys())

    for (const p of products) {
      if (p.is_manual_price) continue
      const dbName = p.name
      const nDb = normalizeName(dbName)
      let price = null

      if (priceMap.has(nDb)) {
        price = priceMap.get(nDb)
      } else {
        // fuzzy: find any key containing db name or vice versa
        const candidate = keys.find((k) => k.includes(nDb) || nDb.includes(k))
        if (candidate) price = priceMap.get(candidate)
      }

      if (price && price > 0) {
        matched++
        const { error: upErr } = await supabase
          .from('products')
          .update({ price_usd: Number(price) })
          .eq('id', p.id)
          .eq('inventory_id', p.inventory_id)
          .eq('is_manual_price', false)
        if (!upErr) {
          updated++
          if (examples.length < 10) examples.push(`✅ ${p.name}: US$ ${Number(price).toFixed(2)}`)
        }
      }
    }

    console.log(`🎯 Coincidencias: ${matched} / ${products.length}`)
    console.log(`✅ Actualizados: ${updated}`)
    if (examples.length) {
      console.log('Ejemplos:')
      examples.forEach((e) => console.log(' -', e))
    }
  } catch (e) {
    console.error('❌ Error en batch de precios:', e?.message || e)
    process.exit(1)
  }
}

main()
