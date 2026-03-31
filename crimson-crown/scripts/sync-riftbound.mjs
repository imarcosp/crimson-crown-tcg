import 'dotenv/config'
import axios from 'axios'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const JUSTTCG_API_KEY = process.env.JUSTTCG_API_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !JUSTTCG_API_KEY) {
  console.error('❌ Faltan variables de entorno.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const changeLog = []
const changeSummary = { inserted: 0, updated: 0, imageUpdates: 0 }

const api = axios.create({
  baseURL: 'https://api.justtcg.com/v1',
  headers: {
    'X-API-Key': JUSTTCG_API_KEY,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9'
  },
  timeout: 120000 
})

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

function detectFinish(printing) {
  const f = String(printing || '').toLowerCase()
  if (f.includes('etched')) return 'Etched'
  if ((f.includes('foil') && !f.includes('non')) || f.includes('holo')) return 'Foil'
  return 'Non-Foil'
}

function normalizeLoose(str) {
  return String(str || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function splitSetAndCollector(rawSetName) {
  const s = String(rawSetName || '').trim()
  if (!s) return { set_name: '', collector_number: '' }
  const m1 = s.match(/^(.*?)[\s:,-]*#\s*([0-9a-zA-Z\/\.\-]+)\s*$/)
  if (m1) return { set_name: String(m1[1] || '').trim(), collector_number: String(m1[2] || '').trim() }
  const m2 = s.match(/^(.*?)[\s:,-]+([0-9]+\/[0-9]+)\s*$/)
  if (m2) return { set_name: String(m2[1] || '').trim(), collector_number: String(m2[2] || '').trim() }
  return { set_name: s, collector_number: '' }
}

function isBlank(v) {
  return v == null || String(v).trim() === '' || String(v).trim().toLowerCase() === 'null' || String(v).trim().toLowerCase() === 'undefined'
}

async function findImage(card) {
  if (card.tcgplayerId) return `https://tcgplayer-cdn.tcgplayer.com/product/${card.tcgplayerId}_in_1000x1000.jpg`
  const direct = card?.image || card?.imageUrl || card?.images?.small || card?.images?.normal
  if (direct) return direct
  try {
    const res = await api.get(`/cards/${encodeURIComponent(card.id)}`, { params: { game: 'riftbound-league-of-legends-trading-card-game' } })
    const c = res?.data?.data || {}
    return c.image || c.imageUrl || c.images?.normal || c.images?.small || ''
  } catch { return '' }
}

function isSealedProduct(name) {
  const n = name.toLowerCase()
  const forbidden = ['booster box', 'booster pack', 'display', 'case', 'bundle', 'booster case', 'blister']
  return forbidden.some(term => n.includes(term))
}

function isAccessoryProduct(name) {
  const n = String(name || '').toLowerCase()
  const terms = ['sleeve', 'sleeves', 'playmat', 'binder', 'deck box', 'deckbox', 'token', 'tokens', 'accessory', 'accessories', 'starter deck', 'starter', 'preconstructed', 'kit']
  return terms.some(t => n.includes(t))
}

async function getRiftboundSets() {
  console.log('📂 Obteniendo lista de Sets...')
  try {
    const res = await api.get('/sets', { params: { game: 'riftbound-league-of-legends-trading-card-game' } })
    const allSets = res.data.data || []
    const targetSets = allSets.filter(s => !(s.name || '').toLowerCase().includes('sealed'))
    console.log(`✅ Sets encontrados: ${allSets.length}. Importando ${targetSets.length} sets.`)
    return targetSets
  } catch (e) {
    console.error('❌ Error obteniendo sets:', e.message)
    return []
  }
}

async function fetchCardsFromSet(setId, setName) {
  const all = []
  let offset = 0
  let hasMore = true
  const PER_PAGE = 20
  console.log(`📡 Descargando set: "${setName}"...`)
  while (hasMore) {
    try {
      const res = await api.get('/cards', { params: { game: 'riftbound-league-of-legends-trading-card-game', set: setId, limit: PER_PAGE, offset: offset, include_null_prices: true } })
      const rows = res.data.data || []
      if (rows.length === 0) { hasMore = false; break }
      const firstId = rows[0]?.id
      if (all.some(c => c.id === firstId)) break
      const validCards = rows.filter(c => !isSealedProduct(c.name) && !isAccessoryProduct(c.name))
      all.push(...validCards)
      console.log(`   Offset ${offset}: ${validCards.length} cartas válidas.`)
      if (rows.length < PER_PAGE) hasMore = false
      else { offset += PER_PAGE; await sleep(7000) }
    } catch (e) {
      console.error(`❌ Error offset ${offset}:`, e.message)
      if (e.code === 'ECONNABORTED') { await sleep(5000); continue }
      hasMore = false
    }
  }
  return all
}

async function findExistingCandidateByMeta({ tcg, name, finish, setName, collector_number }) {
  const safeSet = String(setName || '').replace(/%/g, '')
  const base = supabase
    .from('products')
    .select('id, name, set_name, collector_number, rarity, scryfall_id, metadata, image_url, finish, language')
    .eq('tcg', tcg)
    .eq('finish', finish)
    .eq('name', name)

  let rows = []
  if (safeSet) {
    const r1 = await base.ilike('set_name', `%${safeSet}%`).limit(50)
    rows = Array.isArray(r1?.data) ? r1.data : []
  }
  if (!rows || rows.length === 0) {
    const r2 = await base.limit(50)
    rows = Array.isArray(r2?.data) ? r2.data : []
  }

  const list = Array.isArray(rows) ? rows : []
  if (list.length === 0) return null

  const targetSetN = normalizeLoose(setName)
  const targetCnN = normalizeLoose(collector_number)
  let best = null
  let bestScore = -1
  for (const r of list) {
    let score = 0
    const rSet = String(r.set_name || '')
    const rCn = String(r.collector_number || '')
    const parsed = splitSetAndCollector(rSet)
    if (normalizeLoose(rSet) === targetSetN) score += 4
    if (normalizeLoose(parsed.set_name) === targetSetN) score += 3
    if (targetCnN && normalizeLoose(rCn) === targetCnN) score += 6
    if (targetCnN && normalizeLoose(parsed.collector_number) === targetCnN) score += 5
    if (isBlank(r.scryfall_id)) score += 2
    if (targetCnN && normalizeLoose(rSet).includes(targetCnN)) score += 1
    if (score > bestScore) { bestScore = score; best = r }
  }
  return best
}

function buildHealUpdate(existing, basePayload, setName, collector_number, just_id) {
  const upd = {}

  if (isBlank(existing.scryfall_id)) upd.scryfall_id = just_id
  if (isBlank(existing.collector_number) && !isBlank(basePayload.collector_number)) upd.collector_number = basePayload.collector_number
  if (isBlank(existing.rarity) && !isBlank(basePayload.rarity)) upd.rarity = basePayload.rarity
  if (isBlank(existing.set_name) && !isBlank(basePayload.set_name)) upd.set_name = basePayload.set_name
  if (isBlank(existing.language) && !isBlank(basePayload.language)) upd.language = basePayload.language

  const metaExisting = existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata) ? existing.metadata : {}
  const metaJust = { just_id }
  const merged = { ...metaExisting, ...metaJust }
  const metaChanged = JSON.stringify(metaExisting) !== JSON.stringify(merged)
  if (!existing.metadata || metaChanged) upd.metadata = merged

  const parsed = splitSetAndCollector(existing.set_name)
  const parsedCnN = normalizeLoose(parsed.collector_number)
  const targetCnN = normalizeLoose(collector_number)
  const setNameN = normalizeLoose(setName)
  if (targetCnN && parsedCnN === targetCnN && normalizeLoose(parsed.set_name) === setNameN) {
    if (normalizeLoose(existing.set_name) !== setNameN) upd.set_name = setName
  }

  return upd
}

async function upsertCard(card, setName) {
  if (isSealedProduct(card.name)) return { skipped: 1 }
  const just_id = card.id
  const name = (card.name || '').trim()
  const collector_number = (card.formattedNumber || card.number || '').trim()
  
  if (!collector_number) return { skipped: 1 }
  
  const rarityRaw = (card.rarity || '').trim()
  const image_url = await findImage(card)
  
  // Extraemos los acabados reales que existen para esta carta
  const availableFinishes = Array.from(new Set((card.variants || []).map(v => detectFinish(v.printing))))
  const finishesToProcess = availableFinishes.length > 0 ? availableFinishes : ['Non-Foil']
  
  let totalInserted = 0
  let totalUpdated = 0

  for (const finish of finishesToProcess) {
    const basePayload = { 
        tcg: 'Riftbound', 
        name, 
        set_name: setName, 
        collector_number, 
        rarity: rarityRaw, 
        language: 'English', 
        finish, 
        scryfall_id: just_id, 
        metadata: { just_id } 
    }
    
    if (image_url) basePayload.image_url = image_url

    let existing = null
    const byId = await supabase
      .from('products')
      .select('id, image_url, collector_number, rarity, set_name, scryfall_id, metadata, language, finish')
      .eq('scryfall_id', just_id)
      .eq('finish', finish)
      .maybeSingle()
    if (byId?.data) existing = byId.data

    if (!existing) {
      existing = await findExistingCandidateByMeta({ tcg: 'Riftbound', name, finish, setName, collector_number })
    }

    if (existing) {
      const upd = buildHealUpdate(existing, basePayload, setName, collector_number, just_id)
      const imageChanged = !!basePayload.image_url && basePayload.image_url !== existing.image_url
      if (imageChanged) upd.image_url = basePayload.image_url

      if (Object.keys(upd).length > 0) {
        const { error } = await supabase.from('products').update(upd).eq('id', existing.id)
        if (!error) {
          totalUpdated++
          changeSummary.updated++
          if (imageChanged) changeSummary.imageUpdates++
          changeLog.push({ action: Object.keys(upd).length === 1 && imageChanged ? 'update_image' : 'heal', id: existing.id, name, finish })
        }
      }
    } else {
      // Inserción inicial con precio 0, esperando al Scraper de Precios
      const insertPayload = { 
          ...basePayload, 
          price_usd: 0, 
          stock: 0, 
          is_manual_price: false, 
          image_url: basePayload.image_url || '' 
      }
      const { data, error } = await supabase.from('products').insert([insertPayload]).select('id').limit(1)
      if (!error) {
        totalInserted++
        changeSummary.inserted++
        const newId = Array.isArray(data) && data[0]?.id ? data[0].id : null
        changeLog.push({ action: 'insert', id: newId, name, set_name: setName, finish })
      }
    }
  }
  return { inserted: totalInserted, updated: totalUpdated }
}

async function main() {
  console.log('🚀 Sincronización de Catálogo Riftbound (Solo Estructura e Imágenes)...')
  
  const sets = await getRiftboundSets()
  if (sets.length === 0) return

  let totalInserted = 0
  let totalUpdated = 0

  for (const set of sets) {
    const cards = await fetchCardsFromSet(set.id, set.name)
    if (cards.length > 0) {
        console.log(`💾 Procesando ${cards.length} cartas de "${set.name}"...`)
        for (const card of cards) {
          const res = await upsertCard(card, set.name)
          totalInserted += res.inserted || 0
          totalUpdated += res.updated || 0
        }
    }
  }

  console.log('------------------------------------------------')
  console.log(`🎉 PROCESO FINALIZADO`)
  console.log(`📥 Nuevas Cartas Creadas: ${totalInserted}`)
  console.log(`🔄 Imágenes Actualizadas: ${totalUpdated}`)
  
  if (changeLog.length > 0) {
    console.log('🧾 Cambios Recientes (hasta 20):')
    changeLog.slice(-20).forEach((c, idx) => {
      console.log(`${idx + 1}. ${c.action.toUpperCase()} • ${c.name} (${c.finish})`)
    })
  }
  console.log('------------------------------------------------')
}

main().catch(e => console.error(e))
