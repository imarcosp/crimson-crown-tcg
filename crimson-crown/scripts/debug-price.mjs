import 'dotenv/config'
import fs from 'fs'
import { pipeline } from 'stream/promises'
import { Readable } from 'node:stream'
import streamChain from 'stream-chain'
const { chain } = streamChain
import ParserPkg from 'stream-json/Parser.js'
const { parser } = ParserPkg
import PickPkg from 'stream-json/filters/Pick.js'
const { pick } = PickPkg
import StreamObjectPkg from 'stream-json/streamers/StreamObject.js'
const { streamObject } = StreamObjectPkg

// ID DE LA CARTA PROBLEMA
const TARGET_SCRYFALL_ID = "26dd02c4-569b-437f-b9dd-bd2f1d86a968"

const PRICES_URL = 'https://mtgjson.com/api/v5/AllPrices.json'
const IDENTIFIERS_URL = 'https://mtgjson.com/api/v5/AllIdentifiers.json'
const TEMP_PRICES_FILE = './temp_debug_prices.json'
const TEMP_ID_FILE = './temp_debug_ids.json'

async function main() {
  console.log(`🎯 INICIANDO DIAGNÓSTICO PARA: ${TARGET_SCRYFALL_ID}`)

  // 1. BUSCAR EL UUID DE MTGJSON USANDO EL ID DE SCRYFALL
  console.log('⬇️  Descargando Identificadores...')
  const idRes = await fetch(IDENTIFIERS_URL)
  if (!idRes.ok) throw new Error('Failed identifiers')
  if (fs.existsSync(TEMP_ID_FILE)) fs.unlinkSync(TEMP_ID_FILE)
  const idFileStream = fs.createWriteStream(TEMP_ID_FILE)
  await pipeline(Readable.fromWeb(idRes.body), idFileStream)
  
  const rawIdData = fs.readFileSync(TEMP_ID_FILE, 'utf8')
  const idJson = JSON.parse(rawIdData)
  const idData = idJson?.data || idJson
  
  let targetUuid = null
  let cardName = "Desconocido"

  // Buscamos el UUID interno de MTGJSON
  const findUuid = (item) => {
    if (item.identifiers?.scryfallId === TARGET_SCRYFALL_ID || item.scryfallId === TARGET_SCRYFALL_ID) {
        targetUuid = item.uuid
        cardName = item.name
    }
  }

  if (Array.isArray(idData)) for (const item of idData) findUuid(item)
  else if (typeof idData === 'object') for (const item of Object.values(idData)) findUuid(item)

  if (fs.existsSync(TEMP_ID_FILE)) fs.unlinkSync(TEMP_ID_FILE)

  if (!targetUuid) {
      console.error("❌ ERROR CRÍTICO: No se encontró ese Scryfall ID en MTGJSON. ¿El ID es correcto?")
      return
  }

  console.log(`✅ UUID Encontrado: ${targetUuid} (${cardName})`)

  // 2. BUSCAR LOS PRECIOS PARA ESE UUID
  console.log('⬇️  Descargando Precios...')
  const pricesRes = await fetch(PRICES_URL)
  if (!pricesRes.ok) throw new Error('Failed to fetch prices')
  if (fs.existsSync(TEMP_PRICES_FILE)) fs.unlinkSync(TEMP_PRICES_FILE)
  const fileStream = fs.createWriteStream(TEMP_PRICES_FILE)
  await pipeline(Readable.fromWeb(pricesRes.body), fileStream)
  
  const pipelineProcessing = chain([
    fs.createReadStream(TEMP_PRICES_FILE),
    parser(),
    pick({ filter: 'data' }),
    streamObject(),
  ])

  console.log('⚙️  Escaneando archivo de precios...')
  
  let found = false

  for await (const { key: uuid, value: priceRoot } of pipelineProcessing) {
    if (uuid === targetUuid) {
        found = true
        console.log("\n📊 --- REPORTE DE DATOS CRUDOS ---")
        
        const paper = priceRoot.paper || {}
        
        // CARD KINGDOM
        const ck = paper.cardkingdom || {}
        const ckRetail = ck.retail || {}
        console.log("\n🏪 CARD KINGDOM (Retail):")
        console.log("   Normal:", JSON.stringify(ckRetail.normal || "Sin datos"))
        console.log("   Foil:  ", JSON.stringify(ckRetail.foil || "Sin datos"))
        console.log("   Etched:", JSON.stringify(ckRetail.etched || "Sin datos"))

        // TCG PLAYER
        const tcg = paper.tcgplayer || {}
        const tcgRetail = tcg.retail || {}
        console.log("\n🛒 TCG PLAYER (Retail -> Market):")
        console.log("   Normal Market:", JSON.stringify(tcgRetail.normal?.market || "Sin datos"))
        console.log("   Foil Market:  ", JSON.stringify(tcgRetail.foil?.market || "Sin datos"))
        console.log("   Etched Market:", JSON.stringify(tcgRetail.etched?.market || "Sin datos"))

        console.log("\n----------------------------------")
        break
    }
  }

  if (!found) {
      console.log("⚠️ UUID encontrado en Identifiers pero NO en Prices. (Posible error de MTGJSON)")
  }

  if (fs.existsSync(TEMP_PRICES_FILE)) fs.unlinkSync(TEMP_PRICES_FILE)
}

main().catch(console.error)