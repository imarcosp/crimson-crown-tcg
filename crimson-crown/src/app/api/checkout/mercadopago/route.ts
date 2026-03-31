import { NextResponse } from 'next/server'
import { MercadoPagoConfig, Preference } from 'mercadopago'
import { siteConfig } from '@/config/site'

// Inicializa el SDK de Mercado Pago
const client = new MercadoPagoConfig({ 
  accessToken: process.env.MP_ACCESS_TOKEN || '' 
})

export async function POST(req: Request) {
  try {
    const body = await req.json()
    console.log("MercadoPago API - Body recibido:", body)
    
    const { orderId, finalAmountARS, items } = body

    if (!orderId || finalAmountARS === undefined || finalAmountARS === null) {
      return NextResponse.json({ error: 'Faltan datos de la orden (orderId o monto)' }, { status: 400 })
    }

    if (!process.env.MP_ACCESS_TOKEN) {
      return NextResponse.json({ error: 'Configuración de Mercado Pago incompleta en el servidor' }, { status: 500 })
    }

    const preference = new Preference(client)

    // Crear un resumen de los items para mostrar en el checkout de MP
    const totalItems = Array.isArray(items) ? items.reduce((acc, item) => acc + (item.quantity || 1), 0) : 1
    const description = `Orden #${String(orderId).slice(0, 8)} - ${siteConfig.shortName} (${totalItems} items)`

    // Expiración: 15 minutos a partir de ahora (Sincronizado con el Cron Job)
    const expirationDate = new Date(Date.now() + 15 * 60 * 1000)

    // Validamos si es entorno de pruebas (UNA SOLA VEZ)
    const isTestToken = process.env.MP_ACCESS_TOKEN?.startsWith('TEST-')

    // Aseguramos que el monto final en ARS sea un entero o tenga máximo 2 decimales limpios
    // para evitar que la API de MP rechace el payload por errores de coma flotante de JS.
    const safeAmountARS = Math.round(Number(finalAmountARS))

    // Usamos explícitamente NEXT_PUBLIC_BASE_URL para asegurar que el Webhook apunte al dominio real en Producción.
    // Si no está definida (ej. en desarrollo local), usamos un fallback.
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || siteConfig.url

    const preferenceBody: any = {
      items: [
        {
          id: String(orderId),
          title: description,
          quantity: 1,
          unit_price: safeAmountARS,
          currency_id: 'ARS',
        }
      ],
      // CRÍTICO: El external_reference vincula el pago de MP con la orden en Supabase
      external_reference: String(orderId),
      
      // Vencimiento del link de pago
      expires: true,
      expiration_date_to: expirationDate.toISOString(),
      
      // URLs de redirección al finalizar el pago. MP es muy estricto con el formato.
      back_urls: {
        success: `${baseUrl}/checkout/success/${orderId}`,
        failure: `${baseUrl}/checkout/failure`,
        pending: `${baseUrl}/checkout/pending`
      },
      // URL a la que MP llamará de fondo (Server-to-Server) cuando el pago cambie de estado
      // Usamos baseUrl para que siempre apunte al dominio actual (Vercel o Producción)
      notification_url: `${baseUrl}/api/webhooks/mercadopago`,
      
      // Retorno automático solo en producción. En Sandbox causa ERR_TOO_MANY_REDIRECTS.
      auto_return: isTestToken ? undefined : 'approved',
    }

    // Inyectar un Payer genérico solo en Sandbox para evitar loops.
    // En producción, MP usa los datos reales que el usuario pone en la pantalla de checkout.
    if (isTestToken) {
        preferenceBody.payer = {
          name: "Test",
          surname: "User",
          email: `test_user_${siteConfig.shortName.toLowerCase().replace(/\s+/g, '')}@testuser.com`,
        }
    }

    const result = await preference.create({ body: preferenceBody })

    // Retornamos el init_point inteligente. 
    // Si el token es de prueba, usamos sandbox_init_point. Si es producción, usamos init_point.
    const checkoutUrl = isTestToken && result.sandbox_init_point ? result.sandbox_init_point : result.init_point

    return NextResponse.json({ 
      init_point: checkoutUrl,
      id: result.id
    })

  } catch (error: any) {
    console.error("Error creando preferencia MP para orden:", error)
    return NextResponse.json({ error: error.message || 'Error interno del servidor' }, { status: 500 })
  }
}