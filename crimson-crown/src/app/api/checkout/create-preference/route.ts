import { NextResponse } from 'next/server'
import { MercadoPagoConfig, Preference } from 'mercadopago'
import { siteConfig } from '@/config/site'

const client = new MercadoPagoConfig({ 
  accessToken: process.env.MP_ACCESS_TOKEN || '' 
})

export async function POST(req: Request) {
  try {
    const { amount, description } = await req.json()

    if (!amount) {
      return NextResponse.json({ error: 'Falta el monto' }, { status: 400 })
    }

    const preference = new Preference(client)

    const result = await preference.create({
      body: {
        items: [
          {
            id: 'test-item',
            title: description || `Compra en ${siteConfig.name}`,
            quantity: 1,
            unit_price: Number(amount),
            currency_id: 'ARS'
          }
        ],
        // Las URLs de retorno deben ser válidas y accesibles
        back_urls: {
          success: `${siteConfig.url}/checkout/success`,
          failure: `${siteConfig.url}/checkout/failure`,
          pending: `${siteConfig.url}/checkout/pending`
        },
        auto_return: 'approved',
      }
    })

    return NextResponse.json({ id: result.id })

  } catch (error: any) {
    console.error("Error creando preferencia de Mercado Pago:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
