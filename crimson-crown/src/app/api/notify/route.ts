import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { siteConfig } from '@/config/site'

export async function POST(req: Request) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('❌ FALTA RESEND_API_KEY en .env.local')
    return NextResponse.json({ success: false, error: 'Server Misconfiguration: Missing API Key' }, { status: 500 })
  }

  const resend = new Resend(apiKey)

  try {
    const body = await req.json()
    const { type, email, customerName, orderNumber, newStatus, link } = body

    const SENDER_EMAIL = `${siteConfig.shortName} <ventas@crimsoncrown.com>`

    let subject = ''
    let htmlContent = ''

    if (type === 'new_order') {
      subject = `🛒 Confirmación: Tu Pedido #${orderNumber} ha iniciado`
      htmlContent = `
        <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
          <div style="background-color: #0F172A; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Confirmación de Pedido</h1>
          </div>
          <div style="padding: 30px; background-color: #ffffff;">
            <h2 style="margin-top: 0; color: #1e293b;">¡Hola ${customerName}!</h2>
            <p style="color: #475569; line-height: 1.6;">Te confirmamos que hemos iniciado la gestión de tu pedido de importación <strong>#${orderNumber}</strong>.</p>
            <p style="color: #475569; line-height: 1.6;">Ya hemos cargado los items solicitados a tu orden. Por favor, ingresa a tu perfil para revisar el detalle de costos y productos:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${link}" style="background-color: #9D1B1B; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">Ver Mi Pedido</a>
            </div>
            <p style="font-size: 14px; color: #94a3b8; margin-bottom: 0;">Te notificaremos nuevamente cuando el estado de tu pedido avance.</p>
          </div>
        </div>
      `
    } else if (type === 'status_update') {
      subject = `✈️ Novedades: Tu pedido #${orderNumber} está ${newStatus}`
      htmlContent = `
        <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
          <div style="background-color: #0F172A; padding: 20px; text-align: center;">
             <h1 style="color: white; margin: 0; font-size: 24px;">Actualización de Estado</h1>
          </div>
          <div style="padding: 30px; background-color: #ffffff;">
            <h2 style="margin-top: 0; color: #1e293b;">¡Buenas noticias, ${customerName}!</h2>
            <p style="color: #475569;">Tu orden de importación <strong>#${orderNumber}</strong> ha avanzado al estado:</p>
            <div style="background-color: #f1f5f9; padding: 15px; border-left: 4px solid #9D1B1B; margin: 20px 0;">
                <h2 style="color: #9D1B1B; text-transform: uppercase; margin: 0;">${newStatus}</h2>
            </div>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${link}" style="background-color: #0F172A; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold;">Ver Seguimiento</a>
            </div>
          </div>
        </div>
      `
    }

    const data = await resend.emails.send({ from: SENDER_EMAIL, to: [email], subject, html: htmlContent })

    if ((data as any)?.error) {
      console.error('❌ Error de Resend:', (data as any).error)
      return NextResponse.json({ success: false, error: (data as any).error.message || 'Error enviando email' }, { status: 400 })
    }

    console.log('✅ Email enviado ID:', (data as any)?.data?.id)
    return NextResponse.json({ success: true, data })

  } catch (error: any) {
    console.error('❌ Error Crítico API:', error)
    return NextResponse.json({ success: false, error: error?.message || 'Error desconocido en servidor' }, { status: 500 })
  }
}
