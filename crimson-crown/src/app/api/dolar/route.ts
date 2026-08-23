import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { fetchDolarCripto } from '@/lib/dolar'
import { EXCHANGE_RATE } from '@/lib/constants'
import { createClient as createServiceClient } from '@supabase/supabase-js'

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
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const writer = serviceKey
    ? createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null

  let value = EXCHANGE_RATE
  let shouldUpdate = true

  const { data } = await supabase
    .from('system_settings')
    .select('*')
    .in('key', ['dolar_cotizacion', 'exchange_rate', 'exchange_rate_auto_enabled', 'enable_imports', 'import_warning_text', 'next_japan_trip_date'])

  const current = data?.find(s => s.key === 'dolar_cotizacion')
  const manualRateSetting = data?.find(s => s.key === 'exchange_rate')
  const autoRateSetting = data?.find(s => s.key === 'exchange_rate_auto_enabled')
  let enableImports = true
  let exchangeRateAutoEnabled = true
  const importsSetting = data?.find(s => s.key === 'enable_imports')
  if (importsSetting) {
    const val = importsSetting.value
    enableImports = val === true || val === 'true'
  }
  if (autoRateSetting) {
    const val = autoRateSetting.value
    exchangeRateAutoEnabled = val === true || val === 'true'
  }
  const manualRateRaw = manualRateSetting?.value
  const manualRate = typeof manualRateRaw === 'number' ? manualRateRaw : Number(String(manualRateRaw ?? '').replace(/^"|"$/g, ''))
  
  let importWarningText = 'Días de Pedido: Lunes, Miércoles y Viernes.<br /><br />Los precios mostrados son una estimación. El precio final se te informará antes de pagar.'
  let nextJapanTripDate: string | null = null
  const warningSetting = data?.find(s => s.key === 'import_warning_text')
  const nextTripSetting = data?.find(s => s.key === 'next_japan_trip_date')
  if (nextTripSetting && nextTripSetting.value) {
    const rawDate = String(nextTripSetting.value).replace(/^"|"$/g, '').trim()
    nextJapanTripDate = rawDate || null
  }
  if (warningSetting && warningSetting.value) {
      let rawText = typeof warningSetting.value === 'string' ? warningSetting.value : String(warningSetting.value)
      
      // Limpieza profunda:
      // 1. Si viene como un JSON stringificado, lo parseamos
      if (rawText.startsWith('"') && rawText.endsWith('"')) {
          try {
              rawText = JSON.parse(rawText)
          } catch {
              rawText = rawText.slice(1, -1) // Fallback simple
          }
      }
      
      // 2. Reemplazar explícitamente los caracteres \n literales por saltos de linea HTML
      rawText = rawText.replace(/\\n/g, '<br />').replace(/\n/g, '<br />')
      
      importWarningText = rawText
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

  if (!exchangeRateAutoEnabled) {
    shouldUpdate = false
    if (!Number.isNaN(manualRate) && manualRate > 0) {
      value = manualRate
    }
  }

  if (exchangeRateAutoEnabled && shouldUpdate) {
    const fetched = await fetchDolarCripto()
    if (typeof fetched === 'number' && fetched > 0) {
      value = fetched
      if (writer) {
        await writer
        .from('system_settings')
        .upsert({ key: 'dolar_cotizacion', value: fetched, updated_at: new Date().toISOString() })
      }
    }
  }

  const clientExchangeRate = Math.floor(value / 10) * 10
  return NextResponse.json({ exchangeRate: clientExchangeRate, enableImports, importWarningText, nextJapanTripDate, exchangeRateAutoEnabled })
}
