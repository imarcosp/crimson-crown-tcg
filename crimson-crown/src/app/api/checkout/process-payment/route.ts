import { NextResponse } from 'next/server'
import { MercadoPagoConfig, Payment } from 'mercadopago'
import { siteConfig } from '@/config/site'

// Inicializa el cliente con el Access Token
const client = new MercadoPagoConfig({ 
  accessToken: process.env.MP_ACCESS_TOKEN || '',
  options: { timeout: 5000 }
})

export async function POST(req: Request) {
  try {
    const body = await req.json()
    console.log("Datos recibidos de MP Brick:", body)

    // Verificamos que tengamos el Token
    if (!process.env.MP_ACCESS_TOKEN) {
      console.error("Mercado Pago Access Token no configurado.")
      return NextResponse.json(
        { error: 'Error de configuración de servidor' },
        { status: 500 }
      )
    }

    // Instanciamos la clase Payment pasándole el cliente
    const payment = new Payment(client)

    // Mercado Pago requiere un email para el payer. Si el brick no lo manda en modo test, usamos un fallback.
    const payerEmail = body.payer?.email || `test_user@${siteConfig.shortName.toLowerCase().replace(/\s+/g, '')}.com`

    // Mercado Pago Brick envía todo lo necesario en body
    const requestData = {
      transaction_amount: Number(body.transaction_amount),
      token: body.token,
      description: body.description || `Compra en ${siteConfig.name}`,
      installments: Number(body.installments) || 1,
      payment_method_id: body.payment_method_id,
      issuer_id: body.issuer_id,
      payer: {
        email: payerEmail,
        identification: body.payer?.identification,
      },
    }

    // Creamos el pago
    const response = await payment.create({ body: requestData })

    // Retornamos el estado al Frontend
    return NextResponse.json({
      status: response.status,
      status_detail: response.status_detail,
      id: response.id,
    })

  } catch (error: any) {
    console.error("Error al procesar pago con Mercado Pago:", error)
    
    // Mercado Pago suele devolver los errores en error.message o error.cause
    return NextResponse.json(
      { 
        error: 'Error procesando el pago', 
        details: error.message || 'Error desconocido' 
      },
      { status: 500 }
    )
  }
}
