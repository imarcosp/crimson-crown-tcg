import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET() {
  // Usamos el Service Role para saltar cualquier restricción temporal
  const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!, 
      process.env.SUPABASE_SERVICE_ROLE_KEY! || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  
  // Buscar productos sin imagen pero con scryfall_id
  const { data: products } = await supabase
    .from('products')
    .select('id, scryfall_id')
    .or('image_url.is.null,image_url.eq.""')
    .not('scryfall_id', 'is', null)
  
  if (!products || products.length === 0) return NextResponse.json({ message: 'No hay imágenes pendientes de actualizar.' })
  
  let updated = 0
  for (const p of products) {
     try {
         const res = await fetch(`https://api.scryfall.com/cards/${p.scryfall_id}`)
         if (res.ok) {
             const json = await res.json()
             const img = json.image_uris?.normal || json.card_faces?.[0]?.image_uris?.normal
             if (img) {
                 await supabase.from('products').update({ image_url: img }).eq('id', p.id)
                 updated++
             }
         }
         // Pausa de 100ms para no saturar a Scryfall
         await new Promise(resolve => setTimeout(resolve, 100))
     } catch (e) {
         console.error(`Error con ID ${p.scryfall_id}`)
     }
  }
  
  return NextResponse.json({ message: `¡Éxito! Se actualizaron ${updated} de ${products.length} imágenes.` })
}