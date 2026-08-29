import 'dotenv/config'
import { createOperationalSupabaseClient as createClient } from './lib/guarded-supabase-client.mjs'
import fs from 'fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const csv = require('csv-parser')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Falta env: NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

function chunk(array, size) {
  const out = []
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size))
  return out
}

function firstImage(imgField) {
  if (!imgField) return ''
  if (Array.isArray(imgField)) return String(imgField[0] || '')
  return String(imgField)
}

async function main() {
  const CSV_CANDIDATES = [
    './Riftbound - All Card Info.xlsx - All Card Data.csv',
    './All Card Data.csv'
  ]
  const CSV_PATH = CSV_CANDIDATES.find((p) => fs.existsSync(p))
  const JSON_PATH = './riftbound_data.json'

  const prepared = []
  let skipped = 0

  if (CSV_PATH && fs.existsSync(CSV_PATH)) {
    console.log('📥 Leyendo CSV de Riftbound...')
    await new Promise((resolve, reject) => {
      fs.createReadStream(CSV_PATH)
        .pipe(csv())
        .on('data', (row) => {
          try {
            const name = String(row['Name'] || '').trim()
            const code = String(row['ID'] || '').trim()
            if (!name || !code) { skipped++; return }
            const region = String(row['Region'] || 'Base Set').trim()
            const rarity = String(row['Rarity'] || '').trim()
            const imageUrl = String(row['Image URL'] || '').trim()
            const mightNum = Number(row['Might'])
            const energyNum = Number(row['Energy'])
            const metadata = {
              might: Number.isFinite(mightNum) ? mightNum : null,
              energy: Number.isFinite(energyNum) ? energyNum : null,
              type: row['Card Type'] || row['Type'] || null,
              ability: row['Ability'] || null,
              domains: row['Domains'] || null,
            }
            prepared.push({
              tcg: 'Riftbound',
              name,
              set_name: region,
              collector_number: code,
              rarity,
              image_url: imageUrl,
              price_usd: 0,
              stock: 0,
              language: 'English',
              finish: 'Non-Foil',
              metadata,
            })
          } catch {}
        })
        .on('end', resolve)
        .on('error', reject)
    })
  } else if (fs.existsSync(JSON_PATH)) {
    console.log('📥 Leyendo riftbound_data.json...')
    const raw = fs.readFileSync(JSON_PATH, 'utf8')
    let data = []
    try {
      data = JSON.parse(raw)
    } catch (e) {
      console.error('❌ Error parseando JSON:', e.message)
      process.exit(1)
    }
    if (!Array.isArray(data)) {
      console.error('❌ El archivo JSON debe ser un array de cartas')
      process.exit(1)
    }
    for (const c of data) {
      const name = String(c?.['Name'] || '').trim()
      const code = String(c?.['Card Code'] || '').trim()
      if (!name || !code) { skipped++; continue }
      prepared.push({
        tcg: 'Riftbound',
        name,
        set_name: String(c?.['Region'] || 'Base Set').trim(),
        collector_number: code,
        rarity: String(c?.['Rarity'] || '').trim(),
        image_url: firstImage(c?.['Images']),
        price_usd: 0,
        stock: 0,
        language: 'English',
        finish: 'Non-Foil',
        metadata: {
          might: c?.['Might'] ?? null,
          energy: c?.['Energy'] ?? null,
          type: c?.['Card Type'] ?? c?.['Type'] ?? null,
          ability: c?.['Ability'] ?? null,
          domains: c?.['Domains'] ?? null,
        },
      })
    }
  } else {
    console.error('❌ No se encontró ni el CSV ni riftbound_data.json en la raíz del proyecto')
    process.exit(1)
  }

  console.log(`🧮 Cartas preparadas: ${prepared.length} (omitidas: ${skipped})`)
  if (!prepared.length) {
    console.log('Nada para importar')
    return
  }

  let inserted = 0
  let updated = 0
  for (let i = 0; i < prepared.length; i++) {
    const item = prepared[i]
    const { data: existing } = await supabase
      .from('products')
      .select('id')
      .eq('tcg', 'Riftbound')
      .eq('collector_number', item.collector_number)
      .eq('set_name', item.set_name)
      .maybeSingle()
    if (existing?.id) {
      const { error: upErr } = await supabase
        .from('products')
        .update({
          tcg: item.tcg,
          name: item.name,
          set_name: item.set_name,
          collector_number: item.collector_number,
          rarity: item.rarity,
          image_url: item.image_url,
          price_usd: item.price_usd,
          stock: item.stock,
          language: item.language,
          finish: item.finish,
          metadata: item.metadata,
        })
        .eq('id', existing.id)
      if (!upErr) updated++
      else console.error(`⚠️ Error actualizando ${item.scryfall_id}:`, upErr.message)
    } else {
      const { error: insErr } = await supabase
        .from('products')
        .insert([{ ...item }])
      if (!insErr) inserted++
      else console.error(`⚠️ Error insertando ${item.scryfall_id}:`, insErr.message)
    }
    if (i % 50 === 0) console.log(`   Progreso: ${i}/${prepared.length} (ins ${inserted}, upd ${updated})`)
  }

  console.log(`🎉 Importación completada. Insertados: ${inserted}, Actualizados: ${updated}`)
}

main().catch((e) => {
  console.error('🔥 Error Fatal:', e)
  process.exit(1)
})
