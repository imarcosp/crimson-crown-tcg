// scripts/find-opportunities.ts
import { createOperationalSupabaseClient as createClient } from './lib/guarded-supabase-client.mjs'
import axios from 'axios'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY es obligatorio para escribir oportunidades de precios.')
}

const supabaseHost = new URL(SUPABASE_URL).hostname
if (!['127.0.0.1', 'localhost'].includes(supabaseHost)) {
  throw new Error('find-opportunities sólo puede ejecutarse contra Supabase local (loopback).')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// CONFIGURACIÓN ACTUALIZADA
const MIN_CK_PRICE = 3.0       // Precio mínimo en CK para considerar la carta
const MARGIN_PERCENTAGE = 0.40 // 40% de diferencia mínima
const SLEEP_MS = 100 

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function main() {
  console.log('🕵️‍♂️ Radar de Arbitraje v2: Separando Foils y Normales (Margen 40%)...')

  // 1. Limpiar tabla
  await supabase.from('price_opportunities').delete().neq('id', 0)

  // 2. Obtener cartas de external_prices que tengan AL MENOS un precio alto (Normal o Foil)
  // Usamos .or() para traer si normal > 3 O foil > 3
  console.log('📥 Descargando precios de referencia...')
  
  const { data: ckCards, error } = await supabase
    .from('external_prices')
    .select('scryfall_id, cardkingdom_retail_normal, cardkingdom_retail_foil')
    .not('scryfall_id', 'is', null)
    .or(`cardkingdom_retail_normal.gt.${MIN_CK_PRICE},cardkingdom_retail_foil.gt.${MIN_CK_PRICE}`)
    // .limit(500) // Descomenta esto si quieres probar rápido con pocas cartas

  if (error) {
    console.error('❌ Error BD:', error.message)
    return
  }

  console.log(`📦 Analizando ${ckCards?.length || 0} candidatos...`)
  let opportunitiesCount = 0

  if (!ckCards) return

  // 3. Loop de Análisis
  for (const item of ckCards) {
    try {
      const { data: scryfallData } = await axios.get(`https://api.scryfall.com/cards/${item.scryfall_id}`)
      
      // Precios TCGPlayer (Costos)
      const tcgNormal = parseFloat(scryfallData.prices.usd || '0')
      const tcgFoil = parseFloat(scryfallData.prices.usd_foil || '0')

      // Precios CardKingdom (Ventas) - Vienen de TU base de datos
      const ckNormal = item.cardkingdom_retail_normal || 0
      const ckFoil = item.cardkingdom_retail_foil || 0

      // --- ANÁLISIS 1: VERSIÓN NORMAL ---
      if (ckNormal > MIN_CK_PRICE && tcgNormal > 0) {
        const maxBuyNormal = ckNormal * (1 - MARGIN_PERCENTAGE)
        
        if (tcgNormal <= maxBuyNormal) {
            const profit = ckNormal - tcgNormal
            const diff = ((ckNormal - tcgNormal) / ckNormal) * 100
            
            await insertOpportunity({
                card_name: scryfallData.name,
                set_name: scryfallData.set_name,
                image_url: scryfallData.image_uris?.normal || scryfallData.card_faces?.[0]?.image_uris?.normal,
                local_price: ckNormal,
                tcg_low: tcgNormal,
                diff_percentage: diff,
                is_foil: false,
                profit
            })
            console.log(`✅ [NORMAL] ${scryfallData.name}: Ganancia $${profit.toFixed(2)} (${diff.toFixed(0)}%)`)
            opportunitiesCount++
        }
      }

      // --- ANÁLISIS 2: VERSIÓN FOIL ---
      if (ckFoil > MIN_CK_PRICE && tcgFoil > 0) {
        const maxBuyFoil = ckFoil * (1 - MARGIN_PERCENTAGE)
        
        if (tcgFoil <= maxBuyFoil) {
            const profit = ckFoil - tcgFoil
            const diff = ((ckFoil - tcgFoil) / ckFoil) * 100

            await insertOpportunity({
                card_name: scryfallData.name,
                set_name: scryfallData.set_name,
                image_url: scryfallData.image_uris?.normal || scryfallData.card_faces?.[0]?.image_uris?.normal,
                local_price: ckFoil,
                tcg_low: tcgFoil,
                diff_percentage: diff,
                is_foil: true, // Marcamos como Foil
                profit
            })
            console.log(`✨ [FOIL]   ${scryfallData.name}: Ganancia $${profit.toFixed(2)} (${diff.toFixed(0)}%)`)
            opportunitiesCount++
        }
      }

      await delay(SLEEP_MS)

    } catch (e: any) {
       // Ignorar errores 404 puntuales
       if (e.response?.status !== 404) console.error(`Err ${item.scryfall_id}: ${e.message}`)
    }
  }

  console.log(`🏁 Finalizado. ${opportunitiesCount} oportunidades encontradas.`)
}

async function insertOpportunity(data: any) {
    const { profit, ...rest } = data
    await supabase.from('price_opportunities').insert({
        ...rest,
        suggested_action: `Comprar ${data.is_foil ? 'FOIL' : 'Normal'} (Margen $${profit.toFixed(2)})`
    })
}

main()
