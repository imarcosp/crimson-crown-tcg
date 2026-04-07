"use server"
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { Resend } from 'resend'
import { siteConfig } from '@/config/site'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function updateOrderStatus(orderId: string, newStatus: string) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get(name) { return cookieStore.get(name)?.value }, set() {}, remove() {} } }
  )

  const { data: order, error: fetchError } = await supabase
    .from('orders')
    .select('*, profiles(email, first_name), order_items(quantity, products(name), price_at_purchase)')
    .eq('id', orderId)
    .single()

  if (fetchError || !order) return { success: false, error: 'Orden no encontrada' }

  const { error: updateError } = await supabase
    .from('orders')
    .update({ status: newStatus })
    .eq('id', orderId)
  if (updateError) return { success: false, error: updateError.message }

  const userEmail = (order as any)?.profiles?.email
if (userEmail && ['shipped', 'completed', 'ready_pickup', 'cancelled'].includes(newStatus)) {
    try {
      let subject = `Actualización de tu orden #${orderId.slice(0, 8)}`
      let messageHtml = `<p>El estado de tu orden ha cambiado a: <strong>${newStatus.toUpperCase()}</strong></p>`

      if (newStatus === 'shipped') {
        subject = `🚀 ¡Tu pedido #${orderId.slice(0, 8)} ha sido enviado!`
        messageHtml = `<p>Buenas noticias, hemos despachado tus cartas.</p><p>Si aplica, pronto verás el código de seguimiento en tu perfil.</p>`
      } else if (newStatus === 'ready_pickup') {
        subject = `📦 Tu pedido #${orderId.slice(0, 8)} está listo para retirar`
        messageHtml = `<p>Ya puedes pasar a buscar tus cartas.</p><p>Te esperamos.</p>`
      } else if (newStatus === 'completed') {
        subject = `✅ Orden #${orderId.slice(0, 8)} Completada`
        messageHtml = `<p>Gracias por tu compra. ¡Esperamos que disfrutes tus cartas!</p>`
      } else if (newStatus === 'cancelled') { // <--- NUEVA LÓGICA
        subject = `🚫 Orden #${orderId.slice(0, 8)} Cancelada`
        messageHtml = `
          <p>Tu orden ha sido cancelada.</p>
          <p>Si corresponde un reembolso, será procesado a la brevedad según nuestros términos.</p>
          <p>Si crees que esto es un error, por favor comunicate por nuestras redes @ElPerchero.TCG.</p>
        `
      }

      await resend.emails.send({
        from: `${siteConfig.shortName} <ventas@crimsoncrown.com>`,
        to: userEmail,
        subject: subject,
        html: `
          <div style="font-family: sans-serif; color: #333;">
            <h1>Hola ${order.profiles?.first_name || 'Cliente'},</h1>
            ${messageHtml}
            <br/>
            <p>Atte, El Equipo de ${siteConfig.name}</p>
          </div>
        `
      })
      console.log(`📧 Email enviado a ${userEmail} por cambio a ${newStatus}`)
    } catch (emailError) {
      console.error('❌ Error enviando email:', emailError)
    }
  }
  
  return { success: true }

}
