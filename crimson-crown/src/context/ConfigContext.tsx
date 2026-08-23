"use client"
import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { EXCHANGE_RATE, parseStoredExchangeRate } from '@/lib/exchange-rate'

type Ctx = {
  exchangeRate: number
  enableImports: boolean
  importWarningText: string
  nextJapanTripDate: string | null
  setExchangeRate: (v: number) => void
  refreshExchangeRate: () => Promise<void>
}

const Ctx = createContext<Ctx>({ 
    exchangeRate: EXCHANGE_RATE, 
    enableImports: true, 
    importWarningText: 'Días de Pedido: Lunes, Miércoles y Viernes.\n\nLos precios mostrados son una estimación. El precio final se te informará antes de pagar.',
    nextJapanTripDate: null,
    setExchangeRate: () => {}, 
    refreshExchangeRate: async () => {} 
})

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [enableImports, setEnableImports] = useState<boolean>(true)
  const [importWarningText, setImportWarningText] = useState<string>('Días de Pedido: Lunes, Miércoles y Viernes.\n\nLos precios mostrados son una estimación. El precio final se te informará antes de pagar.')
  const [nextJapanTripDate, setNextJapanTripDate] = useState<string | null>(null)
  const [exchangeRate, setExchangeRate] = useState<number>(EXCHANGE_RATE)

  const refreshExchangeRate = useCallback(async () => {
    try {
      const res = await fetch('/api/dolar', { cache: 'no-store' })
      const json = await res.json()
      const v = Number(json?.exchangeRate)
      if (!Number.isNaN(v) && v > 0) {
        setExchangeRate(v)
        localStorage.setItem('lastExchangeRate', String(v))
      }
      if (json?.enableImports !== undefined) {
        setEnableImports(json.enableImports)
      }
      if (json?.importWarningText !== undefined) {
        // En caso de que queden \n escapados desde la base de datos
        let cleanedText = json.importWarningText
        if (typeof cleanedText === 'string') {
            cleanedText = cleanedText.replace(/\\n/g, '<br />').replace(/\n/g, '<br />')
        }
        setImportWarningText(cleanedText)
      }
      if (json?.nextJapanTripDate !== undefined) {
        const nextDate = String(json.nextJapanTripDate || '').trim()
        setNextJapanTripDate(nextDate || null)
      }
    } catch {}
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = parseStoredExchangeRate(localStorage.getItem('lastExchangeRate'))
      if (stored !== EXCHANGE_RATE) {
        // Defer the persisted value to the next task so the effect does not
        // synchronously cascade another render during hydration.
        setExchangeRate(stored)
      }
      void refreshExchangeRate()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [refreshExchangeRate])

  return (
    <Ctx.Provider value={{ exchangeRate, enableImports, importWarningText, nextJapanTripDate, setExchangeRate, refreshExchangeRate }}>
      {children}
    </Ctx.Provider>
  )
}

export function useConfig() { return useContext(Ctx) }
