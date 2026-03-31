import 'dotenv/config'
import axios from 'axios'
import { createClient } from '@supabase/supabase-js'

// --- CONFIGURACIÓN ---
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Faltan variables de entorno.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// --- LÓGICA DE NORMALIZACIÓN ---
// Convierte "OGN-001/298" o "001" -> "1"
// Convierte "OGN-001a/298" -> "1a" (Mantiene la variante)
function strictNormalize(code) {
  if (!code) return ''
  const clean = String(code).toLowerCase().split('/')[0] // Quita el "/298"
  const match = clean.match(/(\d+)([a-z]*)/)
  if (match) {
    return `${Number(match[1])}${match[2]}` // Retorna "1" o "1a"
  }
  return clean.replace(/[^a-z0-9]/g, '')
}

async function main() {
  console.log('🖼️ Iniciando Corrección de Imágenes (Fuente: OwenMelbz/Riot)...')

  // 1. URL DEL GIST DE LA COMUNIDAD (Respaldo con imágenes oficiales de Riot)
  // Usamos la URL "raw" para obtener el JSON directo
  const JSON_SOURCE = 'https://gist.githubusercontent.com/OwenMelbz/e04dadf641cc9b81cb882b4612343112/raw/riftbound.json'
  
  let sourceCards = []
  try {
    console.log('📡 Descargando catálogo de imágenes...')
    const { data } = await axios.get(JSON_SOURCE)
    sourceCards = Array.isArray(data) ? data : (data.cards || [])
    console.log(`✅ Catálogo descargado: ${sourceCards.length} cartas encontradas.`)
  } catch (e) {
    console.error('❌ Error fatal descargando JSON:', e.message)
    // Si falla, intentamos una URL alternativa por si acaso
    console.log('⚠️ Intentando URL de respaldo...')
    try {
        const { data } = await axios.get('https://raw.githubusercontent.com/OwenMelbz/riftbound-data/main/cards.json')
        sourceCards = data
    } catch (e2) {
        console.error('❌ Falló también el respaldo. Verifica tu conexión.', e2.message)
        return
    }
  }

  // 2. Crear Mapa de Imágenes
  const imageMap = new Map()
  
  sourceCards.forEach(c => {
    // El Gist de Owen usa 'publicCode' (ej: "OGN-001/298") y 'cardImage.url'
    const code = c.publicCode || c.collectorNumber || c.id
    // Navegamos profundo para encontrar la URL
    const img = c.cardImage?.url || c.image || c.imageUrl
    
    if (code && img) {
      const key = strictNormalize(code)
      imageMap.set(key, img)
    }
  })

  // 3. Actualizar Base de Datos
  const { data: dbProducts, error } = await supabase
    .from('products')
    .select('id, name, collector_number, image_url')
    .eq('tcg', 'Riftbound')

  if (error) {
    console.error('❌ Error leyendo DB:', error.message)
    return
  }

  console.log(`🔍 Analizando ${dbProducts.length} productos en DB...`)

  let updatedCount = 0
  
  for (const p of dbProducts) {
    const dbKey = strictNormalize(p.collector_number)
    const newImage = imageMap.get(dbKey)

    // Solo actualizamos si encontramos una imagen NUEVA o DIFERENTE
    if (newImage && newImage !== p.image_url) {
        
        // Log para ver si detecta variantes ("112a")
        if (dbKey.match(/[a-z]/)) {
            console.log(`✨ VARIANT FIX: ${p.name} (#${p.collector_number}) -> ${newImage}`)
        }

        const { error: updateErr } = await supabase
            .from('products')
            .update({ image_url: newImage })
            .eq('id', p.id)
        
        if (!updateErr) updatedCount++
    }
  }

  console.log('------------------------------------------------')
  console.log(`🎉 CORRECCIÓN FINALIZADA`)
  console.log(`📸 Imágenes actualizadas: ${updatedCount}`)
  console.log('------------------------------------------------')
}

main()