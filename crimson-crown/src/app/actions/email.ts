"use server"
import { render } from '@react-email/render'
import OrderTemplate from '@/components/emails/OrderTemplate'
import { createGuardedSupabaseClient as createClient } from '@/lib/supabase/guarded-constructors'
import { siteConfig } from '@/config/site'
import {
  generateBuylistQuotePdfBuffer,
  getBuylistQuotePdfFileName,
  getBuylistQuotePdfSummary,
} from '@/lib/buylist-quote-pdf'
import { getResendClient } from '@/lib/email/resend-client'

const ADMIN_EMAIL = siteConfig.socialLinks.email || 'crimsoncrownimports@gmail.com'
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || siteConfig.url
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
const FROM_HEADER = `${siteConfig.shortName} <${FROM_EMAIL}>`
const REPLY_TO = siteConfig.socialLinks.email || undefined

// Cliente Supabase para leer la cotización
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Helper: Obtener cotización y calcular ARS redondeado (múltiplos de 10 hacia abajo)
async function getArsTotal(usdAmount: number) {
  try {
    const { data } = await supabase.from('system_settings').select('dolar_cotizacion').single()
    const rate = Number(data?.dolar_cotizacion || 0)
    if (rate <= 0) return 0
    
    const rawArs = usdAmount * rate
    // Redondeo hacia abajo en múltiplos de 10
    return Math.floor(rawArs / 10) * 10
  } catch (error) {
    console.error('Error obteniendo cotización:', error)
    return 0
  }
}

// Bloque HTML de Datos Bancarios (Para inyectar en Importaciones)
const BANK_DETAILS_HTML = `
  <div style="margin-top: 24px; padding: 16px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
    <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #0F172A;">Datos para el Pago</h3>
    
    <div style="margin-bottom: 16px;">
      <strong style="color: #475569; font-size: 12px; text-transform: uppercase;">Transferencia Bancaria (ARS)</strong>
      <ul style="margin: 4px 0 0 0; padding-left: 0; list-style: none; font-size: 14px; color: #334155;">
        <li><strong>Banco:</strong> ${siteConfig.payment.bankName}</li>
        <li><strong>Titular:</strong> ${siteConfig.payment.bankOwner}</li>
        <li><strong>Alias:</strong> ${siteConfig.payment.bankAliasArs}</li>
        <li><strong>CVU:</strong> ${siteConfig.payment.bankCbuArs}</li>
      </ul>
    </div>

    <div>
      <strong style="color: #475569; font-size: 12px; text-transform: uppercase;">Crypto (BNB BEP20)</strong>
      <p style="margin: 4px 0 0 0; font-size: 12px; font-family: monospace; background: #fff; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px;">
        0x76d1f11aad0c31bf5563f646e6e4a4ba1564ebcf
      </p>
    </div>
    
    <p style="margin-top: 12px; font-size: 11px; color: #b45309; background-color: #fffbeb; padding: 8px; border-radius: 4px; border: 1px solid #fcd34d;">
      ⚠️ <strong>Importante:</strong> La cotización del dólar solo es vigente durante el día de la fecha. Si el pago se realiza posteriormente o en efectivo, se tomará la cotización actualizada.
    </p>
  </div>
`

// --- EMAILS DE VENTAS LOCALES ---
export async function sendOrderEmails(orderId: string, userEmail: string, items: any[], total: number) {
  const formattedItems = items.map(i => ({
    name: i.name,
    quantity: i.quantity,
    price: Number(i.price_usd || i.price || 0)
  }))

  // Calcular precio en ARS
  const totalArs = await getArsTotal(total)

  let customerSent = false
  let adminSent = false

  console.log(`📧 Enviando emails Orden #${orderId} (USD: ${total}, ARS: ${totalArs})`)

  let customerHtml: string
  let adminHtml: string

  try {
    // Pasamos 'totalArs' al template
    customerHtml = await render(OrderTemplate({ orderId, items: formattedItems, total, totalArs, type: 'customer' }))
    adminHtml = await render(OrderTemplate({ orderId, items: formattedItems, total, totalArs, type: 'admin' }))
  } catch (renderError) {
    console.error('❌ Error renderizando templates:', renderError)
    return { success: false, error: 'Error generando HTML' }
  }

  try {
    await getResendClient().emails.send({
      from: FROM_HEADER,
      replyTo: REPLY_TO,
      to: userEmail,
      subject: `Confirmación de Orden #${orderId.slice(0, 8)}`,
      html: customerHtml
    })
    customerSent = true
  } catch (error) {
    console.error(`⚠️ Falló email Cliente (${userEmail})`, error)
  }

  try {
    await getResendClient().emails.send({
      from: FROM_HEADER,
      replyTo: REPLY_TO,
      to: ADMIN_EMAIL,
      subject: `💰 Nueva Venta: #${orderId.slice(0, 8)}`,
      html: adminHtml
    })
    adminSent = true
  } catch (error) {
    console.error(`❌ Falló email Admin`, error)
  }

  return { success: customerSent || adminSent }
}

// --- EMAILS DE IMPORTACIONES ---
export async function sendImportNotification(
  emailOrParams: any,
  customerName?: string,
  orderNumber?: string,
  type?: 'new_order' | 'status_update',
  link?: string,
  items: any[] = [],
  newStatus?: string
) {
  try {
    let email = ''
    let name = ''
    let ord = ''
    let kind: 'new_order' | 'status_update' = 'new_order'
    let href = '' 
    let its: any[] = []
    let status: string | undefined

    if (typeof emailOrParams === 'object' && emailOrParams !== null) {
      email = emailOrParams.email
      name = emailOrParams.customerName
      ord = emailOrParams.orderNumber
      kind = emailOrParams.type
      href = emailOrParams.link && !emailOrParams.link.includes('localhost') ? emailOrParams.link : `${BASE_URL}/profile?tab=imports`
      its = emailOrParams.items || []
      status = emailOrParams.newStatus
    } else {
      email = String(emailOrParams)
      name = String(customerName)
      ord = String(orderNumber)
      kind = type as any
      href = link && !link.includes('localhost') ? link : `${BASE_URL}/profile?tab=imports`
      its = items || []
      status = newStatus
    }

    let itemsHtml = ''
    let totalUSD = 0

    if (its.length > 0) {
        itemsHtml = `<table style="width:100%; border-collapse:collapse; font-size:12px; margin-top:16px;">
          <thead>
            <tr>
              <th style="text-align:left; padding:8px; border-bottom:1px solid #eee;">Cant</th>
              <th style="text-align:left; padding:8px; border-bottom:1px solid #eee;">Producto</th>
              <th style="text-align:right; padding:8px; border-bottom:1px solid #eee;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${its.map((i) => {
                const qty = Number(i.quantity ?? 1)
                const nameCell = i.product_name || i.name || ''
                const price = Number(i.unit_price ?? i.price_usd ?? i.price ?? 0)
                const tax = price * (Number(i.tax_percent ?? 0) / 100)
                const shipping = Number(i.shipping_cost ?? 0)
                const lineTotal = (price + tax + shipping) * qty
                totalUSD += lineTotal
                return `<tr>
                  <td style="padding:8px; border-bottom:1px solid #eee;">${qty}</td>
                  <td style="padding:8px; border-bottom:1px solid #eee;">${nameCell}</td>
                  <td style="padding:8px; border-bottom:1px solid #eee; text-align:right; font-weight:700;">$${lineTotal.toFixed(2)}</td>
                </tr>`
              }).join('')}
          </tbody>
        </table>`
    }

    // Calcular totales financieros para Importación
    let financialHtml = ''
    if (totalUSD > 0 && kind === 'new_order') {
        const totalArs = await getArsTotal(totalUSD)
        const arsFormatted = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(totalArs)
        
        financialHtml = `
            <div style="margin-top: 16px; text-align: right; padding-top: 10px; border-top: 2px solid #f1f5f9;">
                <p style="margin: 0; font-size: 14px; color: #64748b;">Total en Dólares: <strong>US$ ${totalUSD.toFixed(2)}</strong></p>
                <p style="margin: 4px 0 0 0; font-size: 18px; color: #0F172A;">Total en Pesos: <strong>${arsFormatted}</strong></p>
            </div>
            ${BANK_DETAILS_HTML}
        `
    }

    let subject = ''
    let html = ''
    
    if (kind === 'new_order') {
      subject = `📦 Tu Pedido al Exterior #${ord} ha iniciado`
      html = `<div style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;">
        <h2 style="margin:0 0 8px 0;color:#0F172A;">Hola ${name}</h2>
        <p>Hemos recibido tu pedido de importación <strong>#${ord}</strong>.</p>
        ${itemsHtml}
        ${financialHtml}
        <div style="text-align:center; margin:24px 0;">
          <a href="${href}" style="background:#0F172A;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">Ver Pedido</a>
        </div>
      </div>`
    } else {
      subject = `✈️ Actualización Pedido #${ord}: ${status || ''}`
      html = `<div style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;">
        <h2 style="margin:0 0 8px 0;color:#0F172A;">Hola ${name}</h2>
        <p>Tu pedido de importación <strong>#${ord}</strong> ha cambiado de estado a: <strong>${status || ''}</strong>.</p>
        <div style="text-align:center; margin:24px 0;">
          <a href="${href}" style="background:#0F172A;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">Ver Estado</a>
        </div>
      </div>`
    }

    await getResendClient().emails.send({
      from: FROM_HEADER,
      replyTo: REPLY_TO,
      to: email,
      subject,
      html,
    })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message }
  }
}

// --- EMAILS DE BUYLIST ---
export async function sendBuylistNotification(params: {
    type: 'submitted' | 'counter_offer' | 'approved' | 'rejected' | 'manual_quote_ready',
    buylistId: string,
    userEmail: string,
    userName?: string,
    total?: number,
    link: string
}) {
    try {
        const { type, buylistId, userEmail, userName, total, link } = params
        const shortId = buylistId.slice(0, 8)
        let subject = ''
        let htmlBody = ''
        let recipient = userEmail
        
        const safeLink = link && !link.includes('localhost') ? link : `${BASE_URL}/profile?tab=quotes`
        const btnStyle = "background:#0F172A;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;margin-top:20px;"

        if (type === 'submitted') {
            recipient = ADMIN_EMAIL
            subject = `📥 Nueva Solicitud de Venta #${shortId}`
            htmlBody = `
                <h2>Nueva Buylist Recibida</h2>
                <p>El usuario <strong>${userEmail}</strong> quiere vender cartas.</p>
                <p>Total estimado: <strong>US$ ${total?.toFixed(2)}</strong></p>
                <a href="${safeLink}" style="${btnStyle}">Revisar Solicitud</a>
            `
        } else if (type === 'counter_offer') {
            subject = `⚠️ Acción Requerida: Solicitud de Venta #${shortId}`
            htmlBody = `
                <h2>Hemos revisado tu solicitud</h2>
                <p>Hola ${userName || 'Usuario'},</p>
                <p>Hemos analizado tu lista y te hemos enviado una <strong>contraoferta final</strong> de:</p>
                <h3 style="color:#059669;font-size:24px;">US$ ${total?.toFixed(2)}</h3>
                <p>Por favor ingresa a tu perfil para Aceptar o Rechazar la propuesta.</p>
                <a href="${safeLink}" style="${btnStyle}">Ver Contraoferta</a>
            `
        } else if (type === 'approved') {
            subject = `✅ Solicitud Aprobada #${shortId}`
            htmlBody = `
                <h2>¡Pago Acreditado!</h2>
                <p>Hola ${userName || 'Usuario'},</p>
                <p>Tu venta ha sido completada exitosamente. Se han acreditado <strong>US$ ${total?.toFixed(2)}</strong> en tu cuenta.</p>
                <a href="${safeLink}" style="${btnStyle}">Ver Mi Saldo</a>
            `
        } else if (type === 'manual_quote_ready') {
            subject = `📄 Tu cotización de compra #${shortId} está lista`
            htmlBody = `
                <h2>Tu cotización ya está disponible</h2>
                <p>Hola ${userName || 'Usuario'},</p>
                <p>El staff preparó tu cotización manual y ya puedes revisarla en tu perfil.</p>
                <h3 style="color:#059669;font-size:24px;">US$ ${total?.toFixed(2)}</h3>
                <p>Si aceptas la propuesta, el monto se acreditará como créditos de tienda y podrás usarlos enseguida en la web.</p>
                <a href="${safeLink}" style="${btnStyle}">Ver Cotización</a>
            `
        }

        const payload: any = {
            from: FROM_HEADER,
            replyTo: REPLY_TO,
            to: recipient,
            subject,
            html: `<div style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;text-align:center;">${htmlBody}</div>`
        }

        if (type === 'manual_quote_ready') {
            const summary = await getBuylistQuotePdfSummary(buylistId)
            const pdfBuffer = await generateBuylistQuotePdfBuffer(summary)
            payload.attachments = [
                {
                    filename: getBuylistQuotePdfFileName(summary),
                    content: pdfBuffer.toString('base64'),
                },
            ]
        }

        await getResendClient().emails.send(payload)

        return { success: true }
    } catch (e: any) {
        console.error('Error enviando email buylist:', e)
        return { success: false, error: e.message }
    }
}

// --- NOTIFICACIÓN ADMIN: ORDEN ACTUALIZADA (MERGE) ---
export async function notifyAdminOrderUpdated(params: {
    orderNumber: string,
    customerName: string,
    itemsCount: number,
    link: string
}) {
    try {
        await getResendClient().emails.send({
            from: FROM_HEADER,
            replyTo: REPLY_TO,
            to: ADMIN_EMAIL,
            subject: `📦 Orden Actualizada #${params.orderNumber} (Items Agregados)`,
            html: `
                <div style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;">
                    <h2 style="color:#0F172A;">Orden Actualizada #${params.orderNumber}</h2>
                    <p>El cliente <strong>${params.customerName}</strong> ha agregado <strong>${params.itemsCount} nuevos items</strong> a su orden existente.</p>
                    <div style="text-align:center; margin:24px 0;">
                        <a href="${params.link}" style="background:#0F172A;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">Ver Orden</a>
                    </div>
                </div>
            `
        })
        return { success: true }
    } catch (e: any) {
        console.error('Error notificando update:', e)
        return { success: false }
    }
}
