import { NextResponse } from 'next/server'
import {
  createGuardedServerClient as createServerClient,
  createGuardedSupabaseClient as createClient,
} from '@/lib/supabase/guarded-constructors'
import { cookies } from 'next/headers'

export async function GET() {
  const cookieStore = await cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get(name: string) { return cookieStore.get(name)?.value } } },
  )
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { data: isAdmin, error: adminError } = await authClient.rpc('is_admin')
  if (adminError || !isAdmin) return NextResponse.json({ error: 'Sólo administradores' }, { status: 403 })

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return NextResponse.json({ error: 'Falta configuración de servicio' }, { status: 503 })

  // Usamos el Service Role sólo después de autenticar y autorizar al admin.
  const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
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
