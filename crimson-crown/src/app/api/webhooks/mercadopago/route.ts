import { NextResponse } from 'next/server'
import { MercadoPagoConfig, Payment } from 'mercadopago'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { siteConfig } from '@/config/site'

// 1. FORZAR RUTA DINÁMICA: Evita que Vercel cachee o bloquee el webhook
export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Permite hasta 60s de ejecución en Vercel

// Inicializa SDK de MP
const client = new MercadoPagoConfig({ 
  accessToken: process.env.MP_ACCESS_TOKEN || '' 
})

// Inicializa Resend
const resend = new Resend(process.env.RESEND_API_KEY)

// Inicializa Supabase con Service Role para bypassear RLS en el webhook
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    console.log("🔔 [Webhook MP] Petición POST entrante...")
    
    // Verificación rápida de variables críticas
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.error("❌ [Webhook MP] ERROR: Falta SUPABASE_SERVICE_ROLE_KEY")
    }
    if (!process.env.MP_ACCESS_TOKEN) {
        console.error("❌ [Webhook MP] ERROR: Falta MP_ACCESS_TOKEN")
    }

    // MP envía datos en la URL (searchParams)
    const url = new URL(req.url)
    const topic = url.searchParams.get('topic') || url.searchParams.get('type')
    const id = url.searchParams.get('data.id') || url.searchParams.get('id')

    // 2. LECTURA SEGURA DEL BODY: Evita el error silencioso si MP no manda JSON
    let body: any = {}
    try {
        const textBody = await req.text()
        if (textBody) {
            body = JSON.parse(textBody)
        }
    } catch (e) {
        console.log("⚠️ [Webhook MP] El body no era JSON válido o estaba vacío")
    }

    const action = body.action || topic
    const paymentId = body.data?.id || id

    console.log(`🔎 [Webhook MP] Action: ${action}, PaymentID: ${paymentId}`)

    // Siempre respondemos 200 rápido a Mercado Pago para que no nos penalice
    if (!paymentId) {
        console.log("⚠️ [Webhook MP] No se encontró Payment ID. Ignorando.")
        return NextResponse.json({ received: true }, { status: 200 })
    }

      // Buscamos los detalles reales del pago en MP por seguridad (no confiamos ciegamente en el webhook)
      const paymentClient = new Payment(client)
      const paymentInfo = await paymentClient.get({ id: paymentId })

      // El external_reference es nuestro orderId de Supabase
      const orderId = paymentInfo.external_reference
      const status = paymentInfo.status

      if (orderId) {
        // Buscamos el estado actual de la orden
        const { data: currentOrder } = await supabase
            .from('orders')
            .select('status')
            .eq('id', orderId)
            .single()

        if (currentOrder) {
            // === CASO PAGO APROBADO ===
            if (status === 'approved') {
                if (currentOrder.status === 'pending_payment') {
                    await supabase
                      .from('orders')
                      .update({ 
                        status: 'paid',
                        delivery_notes: `Pago confirmado por Mercado Pago (Ref: ${paymentId})`
                      })
                      .eq('id', orderId)
                    console.log(`✅ Orden ${orderId} marcada como PAGADA exitosamente por Webhook MP.`)

                    // Notificar al Admin del pago en diferido (ej. Rapipago)
                    try {
                        await resend.emails.send({
                            from: `${siteConfig.shortName} <pedidos@elpercherotcg.com>`,
                            to: 'mjperchezabala@gmail.com',
                            subject: `💰 PAGO APROBADO (Mercado Pago): Orden #${String(orderId).slice(0, 8)}`,
                            html: `<h2>¡Dinero Acreditado!</h2>
                                   <p>El cliente acaba de pagar la orden <strong>#${String(orderId).slice(0, 8)}</strong> a través de Mercado Pago (Efectivo/Transferencia).</p>
                                   <p>La orden ha pasado a estado <strong>Pagado</strong> automáticamente.</p>
                                   <p>Ref de Pago: ${paymentId}</p>`
                        })
                    } catch (e) { console.error('Error enviando mail de pago', e) }
                } 
                else if (currentOrder.status === 'cancelled') {
                    console.log(`🧟 Orden ZOMBIE detectada: ${orderId}. Pagó después de ser cancelada.`)
                    
                    // 1. Revivimos la orden a pagada, PERO con una nota crítica
                    await supabase
                      .from('orders')
                      .update({ 
                        status: 'paid',
                        delivery_notes: `⚠️ PAGO TARDÍO (Ref: ${paymentId}). La orden había sido cancelada por abandono. Por favor, verificar stock manualmente.`
                      })
                      .eq('id', orderId)

                    // 2. Intentamos volver a descontar el stock de las cartas
                    const { data: items } = await supabase.from('order_items').select('product_id, quantity').eq('order_id', orderId)
                    if (items) {
                        for (const item of items) {
                            const { data: product } = await supabase.from('products').select('stock').eq('id', item.product_id).single()
                            if (product) {
                                await supabase.from('products').update({ stock: Math.max(0, product.stock - item.quantity) }).eq('id', item.product_id)
                            }
                        }
                    }

                    // Notificar al Admin del caso extremo
                    try {
                        await resend.emails.send({
                            from: `${siteConfig.shortName} <pedidos@elpercherotcg.com>`,
                            to: 'mjperchezabala@gmail.com',
                            subject: `🚨 URGENTE: Pago ZOMBIE Aprobado - Orden #${String(orderId).slice(0, 8)}`,
                            html: `<h2 style="color:red;">¡Atención Requiere Acción Manual!</h2>
                                   <p>Un cliente pagó la orden <strong>#${String(orderId).slice(0, 8)}</strong> DESPUÉS de que el sistema la había cancelado por abandono.</p>
                                   <p>El dinero ya entró a tu cuenta (Ref: ${paymentId}), y la orden fue devuelta a estado "Pagado".</p>
                                   <p><strong>⚠️ Por favor, revisa inmediatamente si todavía tienes stock de las cartas, ya que durante el tiempo que estuvo cancelada alguien más pudo haberlas comprado.</strong></p>`
                        })
                    } catch (e) { console.error('Error enviando mail zombie', e) }
                }
            }
            // === CASO PAGO RECHAZADO / CANCELADO ===
            else if (status === 'rejected' || status === 'cancelled') {
                if (currentOrder.status === 'pending_payment') {
                    console.log(`❌ Pago rechazado por Mercado Pago para orden ${orderId}. Cancelando y devolviendo stock inmediatamente.`)
                    
                    // 1. Devolver el stock
                    const { data: items } = await supabase.from('order_items').select('product_id, quantity').eq('order_id', orderId)
                    if (items) {
                        for (const item of items) {
                            const { data: product } = await supabase.from('products').select('stock').eq('id', item.product_id).single()
                            if (product) {
                                await supabase.from('products').update({ stock: product.stock + item.quantity }).eq('id', item.product_id)
                            }
                        }
                    }

                    // 2. Cancelar la orden
                    await supabase
                      .from('orders')
                      .update({ 
                        status: 'cancelled',
                        delivery_notes: `Pago rechazado por Mercado Pago (Ref: ${paymentId}). Stock devuelto.`
                      })
                      .eq('id', orderId)

                    // 3. Notificar al Cliente
                    const { data: userOrder } = await supabase.from('orders').select('profiles(email, first_name)').eq('id', orderId).single()
                    const userEmail = (userOrder?.profiles as any)?.email
                    const userName = (userOrder?.profiles as any)?.first_name || 'Cliente'

                    if (userEmail) {
                        try {
                            await resend.emails.send({
                                from: `${siteConfig.shortName} <pedidos@elpercherotcg.com>`,
                                to: userEmail,
                                subject: `❌ Pago Rechazado - Orden #${String(orderId).slice(0, 8)} Cancelada`,
                                html: `<div style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;">
                                        <h2 style="color:#E91E63;">Hola ${userName},</h2>
                                        <p>Te escribimos para avisarte que Mercado Pago <strong>ha rechazado el pago</strong> de tu orden #${String(orderId).slice(0, 8)}.</p>
                                        <p>Por este motivo, la orden ha sido cancelada automáticamente y los productos han regresado a nuestro stock.</p>
                                        <p>Esto puede ocurrir por falta de fondos, límites de la tarjeta, o sistemas de seguridad de tu banco. Te invitamos a volver a nuestra tienda y armar tu carrito nuevamente utilizando otro método de pago.</p>
                                        <a href="${siteConfig.url}/catalog" style="display:inline-block;background:#0F172A;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:bold;margin-top:16px;">Volver a la Tienda</a>
                                       </div>`
                            })
                        } catch (e) { console.error('Error enviando mail de pago rechazado', e) }
                    }
                }
            }
        }
      }

    // Siempre debemos responder 200 OK a Mercado Pago rápido para que no reintente
    return NextResponse.json({ received: true }, { status: 200 })

  } catch (error: any) {
    console.error('💥 Error procesando Webhook de Mercado Pago:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
