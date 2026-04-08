import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { fetchDolarCripto } from '@/lib/dolar'
import { EXCHANGE_RATE } from '@/lib/constants'

export async function GET() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value },
        set(name: string, value: string, options: any) { try { cookieStore.set({ name, value, ...options }) } catch {} },
        remove(name: string, options: any) { try { cookieStore.set({ name, value: '', ...options }) } catch {} },
      },
    }
  )

  let value = EXCHANGE_RATE
  let shouldUpdate = true

  const { data } = await supabase
    .from('system_settings')
    .select('*')
    .in('key', ['dolar_cotizacion', 'enable_imports', 'import_warning_text'])

  const current = data?.find(s => s.key === 'dolar_cotizacion')
  let enableImports = true
  const importsSetting = data?.find(s => s.key === 'enable_imports')
  if (importsSetting) {
    const val = importsSetting.value
    enableImports = val === true || val === 'true'
  }
  
  let importWarningText = 'Días de Pedido: Lunes, Miércoles y Viernes.\n\nLos precios mostrados son una estimación. El precio final se te informará antes de pagar.'
  const warningSetting = data?.find(s => s.key === 'import_warning_text')
  if (warningSetting && warningSetting.value) {
      importWarningText = typeof warningSetting.value === 'string' ? warningSetting.value : String(warningSetting.value)
  }
  if (current) {
    const raw = typeof current.value === 'number' ? current.value : Number(current.value)
    if (!Number.isNaN(raw) && raw > 0) value = raw
    const updatedAt = current.updated_at ? new Date(current.updated_at) : null
    if (updatedAt) {
      const diff = Date.now() - updatedAt.getTime()
      shouldUpdate = diff > 60 * 60 * 1000
    }
  }

  if (shouldUpdate) {
    const fetched = await fetchDolarCripto()
    if (typeof fetched === 'number' && fetched > 0) {
      value = fetched
      await supabase
        .from('system_settings')
        .upsert({ key: 'dolar_cotizacion', value: fetched, updated_at: new Date().toISOString() })
    }
  }

  const clientExchangeRate = Math.floor(value / 10) * 10
  return NextResponse.json({ exchangeRate: clientExchangeRate, enableImports, importWarningText })
}
