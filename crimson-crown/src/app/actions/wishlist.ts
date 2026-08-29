"use server"
import { createClient } from '@/lib/supabase/server'
import { siteConfig } from '@/config/site'
import { getResendClient } from '@/lib/email/resend-client'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || siteConfig.url

export async function processWishlistNotifications(newItems: { id: string, name: string }[]) {
  if (!newItems || newItems.length === 0) return

  const supabase = await createClient()
  let notificationsSent = 0

  console.log(`🔍 WISH: Revisando alertas para ${newItems.length} items nuevos...`)

  try {
    for (const item of newItems) {
      // OBTENER DETALLES COMPLETOS DEL PRODUCTO (Imagen, Precio, Acabado)
      const { data: productDetails } = await supabase
        .from('products')
        .select('image_url, price_usd, finish, set_name')
        .eq('id', item.id)
        .single()

      const imageUrl = productDetails?.image_url || ''
      const price = productDetails?.price_usd ? `$${Number(productDetails.price_usd).toFixed(2)}` : 'Consultar'
      const finish = productDetails?.finish || 'Standard'
      const setName = productDetails?.set_name || ''

      // 1. Buscar coincidencias EXACTAS (ID)
      const { data: specificMatches } = await supabase
        .from('wishlists')
        .select('id, user_id, profiles(email, first_name)')
        .eq('product_id', item.id)
        .eq('is_specific', true)
        .eq('notified', false)

      // 2. Buscar coincidencias por NOMBRE
      const { data: nameMatches } = await supabase
        .from('wishlists')
        .select('id, user_id, profiles(email, first_name)')
        .eq('card_name', item.name) 
        .eq('is_specific', false)
        .eq('notified', false)

      const allMatches = [...(specificMatches || []), ...(nameMatches || [])]

      if (allMatches.length > 0) {
        console.log(`   --> ¡Match encontrado para ${item.name}! (${allMatches.length} usuarios)`)
        
        for (const match of allMatches) {
          const profile = match.profiles?.[0]
          const email = profile?.email
          const name = profile?.first_name || 'Cliente'
          const userId = match.user_id
          const wishId = match.id

          if (email) {
            // EMAIL MEJORADO CON IMAGEN Y DATOS
            await getResendClient().emails.send({
              from: `${siteConfig.shortName} <ventas@crimsoncrown.com>`,
              to: email,
              subject: `🔔 ¡Stock Disponible! ${item.name}`,
              html: `
                <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                  <div style="background-color: #0F172A; padding: 20px; text-align: center;">
                    <h2 style="color: #ffffff; margin: 0; font-size: 18px;">¡Ya está aquí!</h2>
                  </div>
                  <div style="padding: 24px; text-align: center;">
                    <p style="font-size: 16px; margin-bottom: 20px;">Hola <strong>${name}</strong>, la carta que buscabas ha ingresado al stock:</p>
                    
                    ${imageUrl ? `<img src="${imageUrl}" alt="${item.name}" style="max-width: 200px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); margin-bottom: 16px;" />` : ''}
                    
                    <h3 style="font-size: 20px; font-weight: 800; color: #0F172A; margin: 5px 0;">${item.name}</h3>
                    <p style="margin: 0; color: #64748b; font-size: 14px;">${setName} • ${finish}</p>
                    <p style="font-size: 24px; font-weight: bold; color: #9D1B1B; margin: 15px 0;">${price}</p>
                    
                    <div style="margin-top: 25px;">
                      <a href="${BASE_URL}/product/${item.id}" style="background: #9D1B1B; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Comprar Ahora</a>
                    </div>
                    <p style="font-size: 12px; color: #94a3b8; margin-top: 20px;">Corre antes de que se agote.</p>
                  </div>
                </div>
              `
            })

            // INSERTAR NOTIFICACIÓN IN-APP (Para la campanita)
            if (userId) {
                await supabase.from('notifications').insert({
                    user_id: userId,
                    title: '¡Stock Disponible!',
                    message: `${item.name} (${finish}) ha ingresado al stock.`,
                    link: `/product/${item.id}`,
                    type: 'stock',
                    is_read: false
                })
            }

            // Marcar wishlist como notificado
            await supabase.from('wishlists').update({ notified: true }).eq('id', wishId)
            notificationsSent++
          }
        }
      }
    }
    
    console.log(`✅ WISH: Se enviaron ${notificationsSent} emails de alerta.`)
    return { success: true, count: notificationsSent }

  } catch (e) {
    console.error("❌ Error WISH:", e)
    return { success: false, error: e }
  }
}
