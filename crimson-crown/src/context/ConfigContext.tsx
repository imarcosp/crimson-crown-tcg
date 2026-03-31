"use client"
import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { EXCHANGE_RATE } from '@/lib/constants'

type Ctx = {
  exchangeRate: number
  setExchangeRate: (v: number) => void
  refreshExchangeRate: () => Promise<void>
}

const Ctx = createContext<Ctx>({ exchangeRate: EXCHANGE_RATE, setExchangeRate: () => {}, refreshExchangeRate: async () => {} })

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [exchangeRate, setExchangeRate] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('lastExchangeRate')
      if (stored) {
        const parsed = Number(stored)
        if (!Number.isNaN(parsed) && parsed > 0) return parsed
      }
    }
    return EXCHANGE_RATE
  })

  const refreshExchangeRate = useCallback(async () => {
    try {
      const res = await fetch('/api/dolar', { cache: 'no-store' })
      const json = await res.json()
      const v = Number(json?.exchangeRate)
      if (!Number.isNaN(v) && v > 0) {
        setExchangeRate(v)
        localStorage.setItem('lastExchangeRate', String(v))
      }
    } catch {}
  }, [])

  useEffect(() => { refreshExchangeRate() }, [refreshExchangeRate])

  return (
    <Ctx.Provider value={{ exchangeRate, setExchangeRate, refreshExchangeRate }}>
      {children}
    </Ctx.Provider>
  )
}

export function useConfig() { return useContext(Ctx) }
