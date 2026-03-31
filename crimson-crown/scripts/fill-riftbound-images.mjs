import 'dotenv/config'
import axios from 'axios'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Falta configuración de Supabase')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[,–—-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractNumbers(code) {
  const str = String(code || '').trim()
  const m = str.match(/(?:[A-Z]+-)?(\d+)/i)
  if (!m) return null
  const n = m[1]
  return { raw: n, pad3: n.padStart(3, '0'), pad4: n.padStart(4, '0') }
}

async function downloadJSON() {
  const primary = 'https://gist.githubusercontent.com/OwenMelbz/e04dadf641cc9b81cb882b4612343112/raw/riftbound.json'
  const fallback = 'https://raw.githubusercontent.com/apitcg/riftbound-tcg-data/main/cards.json'
  try {
    const { data } = await axios.get(primary, { timeout: 20000 })
    return Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : [])
  } catch {
    const { data } = await axios.get(fallback, { timeout: 20000 })
    return Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : [])
  }
}

function buildIndex(cards) {
  const byNumber = new Map()
  const byName = new Map()
  for (const c of cards) {
    const img = c?.cardImage?.url || c?.image?.url || c?.image || ''
    if (!img) continue
    const code = c?.publicCode || c?.collectorNumber || c?.code || c?.number || ''
    const nums = extractNumbers(code)
    const nm = normName(c?.name || c?.cardName || '')
    if (nums) {
      byNumber.set(nums.raw, img)
      byNumber.set(nums.pad3, img)
      byNumber.set(nums.pad4, img)
    }
    if (nm) byName.set(nm, img)
  }
  return { byNumber, byName }
}

async function fetchMissingProducts() {
  const PAGE_SIZE = 1000
  let from = 0
  const all = []
  while (true) {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, collector_number, image_url')
      .eq('tcg', 'Riftbound')
      .or('image_url.is.null,image_url.eq.""')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

async function main() {
  try {
    const cards = await downloadJSON()
    const index = buildIndex(cards)
    const missing = await fetchMissingProducts()
    if (!missing.length) { console.log('✅ No hay productos Riftbound sin imagen'); return }
    let updated = 0
    for (const p of missing) {
      const cn = String(p.collector_number || '')
      const numMatch = cn.match(/\d+/)
      const keys = []
      if (numMatch) {
        const n = numMatch[0]
        keys.push(n, n.padStart(3, '0'), n.padStart(4, '0'))
      }
      const nameKey = normName(p.name)
      let img = null
      for (const k of keys) { if (index.byNumber.has(k)) { img = index.byNumber.get(k); break } }
      if (!img && index.byName.has(nameKey)) img = index.byName.get(nameKey)
      if (img) {
        const { error } = await supabase.from('products').update({ image_url: img }).eq('id', p.id)
        if (!error) { updated++; console.log(`✅ Imagen encontrada para ${p.name} (${cn || 's/n'})`) }
      } else {
        console.log(`⚠️ No encontrada: ${p.name}`)
      }
    }
    console.log(`🎉 Completado. Imágenes actualizadas: ${updated}`)
  } catch (e) {
    console.error('❌ Error:', e?.message || e)
    process.exit(1)
  }
}

main()
