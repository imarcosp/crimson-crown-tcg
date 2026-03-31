import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import axios from 'axios'
import { load as cheerioLoad } from 'cheerio'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Falta env: NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
function randDelay() { return 1000 + Math.floor(Math.random() * 2000) }

function parsePrice(text) {
  try {
    const m = String(text || '').match(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+(?:\.[0-9]{2})?)/)
    if (!m) return null
    const numStr = m[1].replace(/,/g, '')
    const n = Number(numStr)
    return Number.isFinite(n) ? n : null
  } catch { return null }
}

async function fetchCoolStuffIncPrice(name) {
  const url = `https://www.coolstuffinc.com/main_search.php?pa=searchOnName&page=1&resultsPerPage=25&q=${encodeURIComponent(name)}`
  try {
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    })
    const $ = cheerioLoad(html)
    let foundPrice = null
    let inStock = false

    const blocks = $('div,li,article,tr')
    blocks.each((_, el) => {
      if (foundPrice) return
      const t = $(el).text().trim()
      if (!t) return
      const hasName = t.toLowerCase().includes(String(name).toLowerCase())
      if (!hasName) return
      const p = parsePrice(t)
      if (p) {
        foundPrice = p
        inStock = /add to cart|in stock/i.test(t) && !/out of stock/i.test(t)
      }
    })

    if (!foundPrice) {
      const p2 = parsePrice($('body').text())
      if (p2) foundPrice = p2
    }

    return { price: foundPrice, source: 'CoolStuffInc', inStock }
  } catch (e) {
    return { price: null, source: 'CoolStuffInc', error: e?.message }
  }
}

async function fetchTCGPlayerMedian(name) {
  // Nota: TCGPlayer es altamente dinámico; intentamos obtener un precio textual "Market/Listed" si aparece en HTML.
  const url = `https://www.tcgplayer.com/search/product/all?productLineName=riftbound&q=${encodeURIComponent(name)}`
  try {
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    })
    const $ = cheerioLoad(html)
    let foundPrice = null
    const bodyText = $('body').text()
    const m1 = bodyText.match(/Listed\s*Median\s*\$\s*([0-9.,]+)/i)
    if (m1) foundPrice = Number(String(m1[1]).replace(/,/g, ''))
    if (!foundPrice) {
      const m2 = bodyText.match(/Market\s*Price\s*\$\s*([0-9.,]+)/i)
      if (m2) foundPrice = Number(String(m2[1]).replace(/,/g, ''))
    }
    if (!Number.isFinite(foundPrice)) foundPrice = null
    return { price: foundPrice, source: 'TCGPlayer' }
  } catch (e) {
    return { price: null, source: 'TCGPlayer', error: e?.message }
  }
}

async function main() {
  console.log('🔎 Obteniendo productos Riftbound...')
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, price_usd, tcg')
    .eq('tcg', 'Riftbound')
  if (error) {
    console.error('❌ Error obteniendo productos:', error.message)
    process.exit(1)
  }
  if (!products || products.length === 0) {
    console.log('⚠️ No hay productos Riftbound para actualizar.')
    return
  }

  console.log(`📦 Procesando ${products.length} cartas...`)
  let updated = 0
  for (let i = 0; i < products.length; i++) {
    const p = products[i]
    const name = p.name
    console.log(`→ [${i + 1}/${products.length}] ${name}`)

    let priceResult = await fetchCoolStuffIncPrice(name)
    if (!priceResult.price || priceResult.price <= 0 || priceResult.inStock === false) {
      await sleep(randDelay())
      const fallback = await fetchTCGPlayerMedian(name)
      if (fallback.price) priceResult = fallback
    }

    if (priceResult.price && priceResult.price > 0) {
      const newPrice = Number(priceResult.price)
      try {
        const { error: upErr } = await supabase
          .from('products')
          .update({ price_usd: newPrice })
          .eq('id', p.id)
        if (!upErr) {
          updated++
          console.log(`   ✅ ${priceResult.source}: US$ ${newPrice.toFixed(2)}`)
        } else {
          console.log(`   ⚠️ Error guardando precio: ${upErr.message}`)
        }
      } catch (saveErr) {
        console.log(`   ❌ Error de BD: ${saveErr?.message}`)
      }
    } else {
      console.log('   ❌ Sin precio válido en fuentes')
    }

    await sleep(randDelay())
  }

  console.log(`🎉 Finalizado. Precios actualizados: ${updated}`)
}

main().catch((e) => {
  console.error('🔥 Error Fatal:', e)
  process.exit(1)
})

