"use client"
import { useEffect } from 'react'
import { useStore } from '@/store/useStore'

export default function CurrencySync() {
  const setRate = useStore((s) => s.setRate)
  const currentRate = useStore((s) => s.usdToArsRate)

  useEffect(() => {
    const syncDolar = async () => {
      try {
        console.log("🔄 CurrencySync: Buscando cotización...")
        const res = await fetch(`/api/dolar?t=${Date.now()}`, { cache: 'no-store', headers: { 'Pragma': 'no-cache' } })
        if (!res.ok) throw new Error(`API Error: ${res.status}`)
        const data = await res.json()
        console.log("💰 API RESPONSE (Sync):", data)
        const rate = data.exchangeRate || data.venta || data.value || data.blue || data.dolar_cotizacion
        if (rate && !isNaN(Number(rate))) {
          const numRate = Number(rate)
          if (numRate !== currentRate) {
            console.log(`✅ Actualizando Store: ${currentRate} -> ${numRate}`)
            setRate(numRate)
          }
        } else {
          console.warn("⚠️ La API no devolvió un valor numérico válido:", data)
        }
      } catch (err) {
        console.error("❌ Error fatal en CurrencySync:", err)
      }
    }
    syncDolar()
  }, [setRate, currentRate])

  return null
}
