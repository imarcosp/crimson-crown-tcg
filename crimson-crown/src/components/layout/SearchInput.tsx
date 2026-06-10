"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Loader2, Search, Sparkles } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { createClient } from '@/lib/supabase/client'
import Image from 'next/image'
const ADVANCED_SEARCH_TCG = 'Magic'

type SearchSuggestion = {
  name: string
  set_name?: string
  collector_number?: string
  finish?: string
  image_url?: string
  stock?: number
  stock_foil?: number
  tcg?: string
}

export default function SearchInput() {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<SearchSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [isInputFocused, setIsInputFocused] = useState(false)
  const [showAdvancedModal, setShowAdvancedModal] = useState(false)
  const [advName, setAdvName] = useState('')
  const [advSet, setAdvSet] = useState('')
  const [advCollector, setAdvCollector] = useState('')
  const [draftAdvName, setDraftAdvName] = useState('')
  const [draftAdvSet, setDraftAdvSet] = useState('')
  const [draftAdvCollector, setDraftAdvCollector] = useState('')
  const [setOptions, setSetOptions] = useState<string[]>([])
  const [showSetSuggestions, setShowSetSuggestions] = useState(false)

  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchAbortRef = useRef<AbortController | null>(null)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const supabase = createClient()

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!showAdvancedModal) {
      setSetOptions([])
      return
    }

    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ mode: 'sets', tcg: ADVANCED_SEARCH_TCG })
        if (draftAdvSet.trim()) params.set('q', draftAdvSet.trim())
        const res = await fetch(`/api/search?${params.toString()}`, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        setSetOptions(Array.isArray(data) ? data : [])
      } catch {}
    }, 250)

    return () => clearTimeout(timer)
  }, [showAdvancedModal, draftAdvSet])

  const hasAdvancedFilters = !!(advName.trim() || advSet.trim() || advCollector.trim())
  const canApplyAdvanced = !!(draftAdvName.trim() || draftAdvSet.trim() || draftAdvCollector.trim())

  const clearSearchState = () => {
    setTerm('')
    setResults([])
    setShowSuggestions(false)
    setIsInputFocused(false)
    setAdvName('')
    setAdvSet('')
    setAdvCollector('')
    setDraftAdvName('')
    setDraftAdvSet('')
    setDraftAdvCollector('')
    setSetOptions([])
    setShowSetSuggestions(false)
  }

  const buildCatalogParams = useCallback((baseQuery: string) => {
    const params = new URLSearchParams()
    params.set('q', baseQuery || 'advanced-search')
    if (advName.trim()) params.set('adv_name', advName.trim())
    if (advSet.trim()) params.set('adv_set', advSet.trim())
    if (advCollector.trim()) params.set('adv_collector', advCollector.trim())
    if (advName.trim() || advSet.trim() || advCollector.trim()) {
      params.set('adv_tcg', ADVANCED_SEARCH_TCG)
    }
    return params
  }, [advCollector, advName, advSet])

  useEffect(() => {
    const effectiveQ = advName.trim() || term.trim()
    if (effectiveQ.length < 3 && !hasAdvancedFilters) {
      setResults([])
      return
    }

    if (effectiveQ.includes('moxfield.com/decks/')) {
      setResults([])
      return
    }

    const timer = setTimeout(async () => {
      searchAbortRef.current?.abort()
      const controller = new AbortController()
      searchAbortRef.current = controller
      setLoading(true)

      try {
        const params = buildCatalogParams(effectiveQ || '')
        const res = await fetch(`/api/search?${params.toString()}`, {
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!res.ok) return
        const data = await res.json()
        if (controller.signal.aborted) return
        const list = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : []
        setResults(list.slice(0, 8))
        if (isInputFocused && effectiveQ.length >= 3) setShowSuggestions(true)
      } catch (error: unknown) {
        if (!(error instanceof Error) || error.name !== 'AbortError') console.error(error)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 250)

    return () => {
      clearTimeout(timer)
      searchAbortRef.current?.abort()
    }
  }, [term, advName, advSet, advCollector, hasAdvancedFilters, isInputFocused, buildCatalogParams])

  const goToSearch = async () => {
    const query = term.trim()
    const effectiveQ = advName.trim() || query
    if (!query && !hasAdvancedFilters) return

    if (effectiveQ.includes('moxfield.com/decks/')) {
      router.push(`/tools/moxfield?deck=${encodeURIComponent(query)}`)
      clearSearchState()
      inputRef.current?.blur()
      return
    }

    const qForCatalog = effectiveQ || ''
    const params = buildCatalogParams(qForCatalog)
    router.push(`/catalog?${params.toString()}`)
    setSearchQuery(qForCatalog)
    setShowSuggestions(false)

    try {
      await supabase.from('search_logs').insert({ query: qForCatalog })
    } catch {}

    clearSearchState()
    inputRef.current?.blur()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await goToSearch()
  }

  const handleSelect = async (name: string, collectorNumber?: string) => {
    const finalQuery = collectorNumber ? `${name} #${collectorNumber}` : name
    const params = buildCatalogParams(finalQuery)
    setSearchQuery(finalQuery)
    router.push(`/catalog?${params.toString()}`)
    try {
      await supabase.from('search_logs').insert({ query: finalQuery })
    } catch {}
    clearSearchState()
  }

  const openAdvancedModal = () => {
    setDraftAdvName(advName)
    setDraftAdvSet(advSet)
    setDraftAdvCollector(advCollector)
    setShowSetSuggestions(false)
    setShowAdvancedModal(true)
  }

  const applyAdvancedFilters = () => {
    if (!canApplyAdvanced) return
    const nextName = draftAdvName.trim()
    const nextSet = draftAdvSet.trim()
    const nextCollector = draftAdvCollector.trim()

    setAdvName(nextName)
    setAdvSet(nextSet)
    setAdvCollector(nextCollector)
    setShowAdvancedModal(false)

    const qForCatalog = nextName || term.trim() || ''
    const params = new URLSearchParams()
    params.set('q', qForCatalog || 'advanced-search')
    if (nextName) params.set('adv_name', nextName)
    if (nextSet) params.set('adv_set', nextSet)
    if (nextCollector) params.set('adv_collector', nextCollector)
    params.set('adv_tcg', ADVANCED_SEARCH_TCG)

    setSearchQuery(qForCatalog)
    router.push(`/catalog?${params.toString()}`)
  }

  const clearAdvancedFilters = () => {
    clearSearchState()
    setShowAdvancedModal(false)
  }

  return (
    <div ref={containerRef} className="relative w-full text-slate-600">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={openAdvancedModal}
          className={`h-10 min-w-[58px] px-2 text-[10px] font-bold leading-[11px] flex flex-col items-center justify-center transition-colors cursor-pointer ${
            hasAdvancedFilters
              ? 'text-white'
              : 'text-white/90 hover:text-white'
          }`}
          aria-label="Abrir búsqueda avanzada"
        >
          <span>Búsqueda</span>
          <span>avanzada</span>
        </button>

        <form onSubmit={handleSubmit} className="relative flex-1">
          <input
            ref={inputRef}
            type="search"
            name="search"
            placeholder="Busca la carta que necesites o pegá tu link de moxfield"
            className="bg-white h-10 px-5 pr-10 rounded-full text-sm focus:outline-none w-full border border-slate-200 focus:border-[#E91E63] transition-colors shadow-sm placeholder:text-slate-400"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onFocus={() => {
              setIsInputFocused(true)
              if ((term.length >= 3 || hasAdvancedFilters) && results.length > 0) setShowSuggestions(true)
            }}
            onBlur={() => setIsInputFocused(false)}
            autoComplete="off"
          />
          <button
            type="submit"
            className="absolute right-0 top-0 mt-2 mr-3 text-slate-400 hover:text-[#E91E63] transition-colors"
            aria-label="Buscar"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
          </button>
        </form>
      </div>

      {showAdvancedModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <button
            type="button"
            onClick={() => setShowAdvancedModal(false)}
            className="absolute inset-0 bg-black/55"
            aria-label="Cerrar modal de búsqueda avanzada"
          />
          <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 p-5">
            <h3 className="text-base font-bold text-slate-800 mb-1">Búsqueda avanzada</h3>
            <p className="text-xs text-slate-500 mb-4">Esta búsqueda avanzada aplica a cartas de Magic.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                value={draftAdvName}
                onChange={(e) => setDraftAdvName(e.target.value)}
                placeholder="Nombre de carta"
                className="h-10 px-3 rounded-lg border border-slate-200 text-sm outline-none focus:border-[#E91E63]"
              />

              <div className="relative">
                <input
                  value={draftAdvSet}
                  onChange={(e) => {
                    setDraftAdvSet(e.target.value)
                    setShowSetSuggestions(true)
                  }}
                  onFocus={() => setShowSetSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSetSuggestions(false), 120)}
                  placeholder="Set / Expansión"
                  className="h-10 w-full px-3 rounded-lg border border-slate-200 text-sm outline-none focus:border-[#E91E63]"
                />

                {showSetSuggestions && setOptions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-56 overflow-y-auto">
                    {setOptions.map((setName) => (
                      <button
                        key={setName}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setDraftAdvSet(setName)
                          setShowSetSuggestions(false)
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        {setName}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <input
                value={draftAdvCollector}
                onChange={(e) => setDraftAdvCollector(e.target.value)}
                placeholder="Número de colección"
                className="h-10 px-3 rounded-lg border border-slate-200 text-sm outline-none focus:border-[#E91E63]"
              />

              <input
                value={ADVANCED_SEARCH_TCG}
                readOnly
                placeholder="TCG seleccionado"
                className="h-10 px-3 rounded-lg border border-slate-200 text-sm outline-none bg-slate-50 text-slate-600"
              />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={clearAdvancedFilters}
                className="h-10 px-4 rounded-lg border border-slate-200 text-sm font-bold text-slate-500 hover:bg-slate-50 cursor-pointer"
              >
                Limpiar
              </button>
              <button
                type="button"
                onClick={applyAdvancedFilters}
                disabled={!canApplyAdvanced}
                className="h-10 px-4 rounded-lg bg-[#E91E63] text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#d81557] cursor-pointer"
              >
                Aplicar búsqueda
              </button>
            </div>
          </div>
        </div>
      )}

      {showSuggestions && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100">
          <div className="p-2">
            <div className="text-[10px] font-bold text-slate-400 uppercase px-2 mb-1">Sugerencias</div>
            {results.map((r, idx) => {
              const finish = String(r.finish || '').toLowerCase()
              const isFoil = (finish.includes('foil') && !finish.includes('non')) || finish.includes('etched')
              const finishLabel = String(r.finish || 'Foil').toUpperCase().replace('NON-FOIL', '').trim() || 'FOIL'

              return (
                <button
                  key={`${r.name}-${r.set_name}-${r.collector_number || ''}-${String(r.finish || '').toLowerCase()}-${idx}`}
                  onClick={() => handleSelect(r.name, r.collector_number)}
                  className="w-full flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg transition-colors text-left group"
                >
                  <div className="w-8 h-11 bg-slate-200 rounded overflow-hidden shrink-0 border border-slate-200">
                    {r.image_url ? <Image src={r.image_url} alt="" width={32} height={44} className="object-cover w-full h-full" unoptimized /> : null}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm text-slate-800 truncate group-hover:text-[#E91E63] transition-colors flex items-center gap-1">
                      {r.name}
                      {isFoil && (
                        <span className="text-[10px] text-purple-600 bg-purple-50 px-1.5 rounded border border-purple-100 font-bold flex items-center gap-0.5">
                          <Sparkles size={8} /> {finishLabel}
                        </span>
                      )}
                      {(r.stock === 0 && r.stock_foil === 0) && (
                        <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200 ml-1">
                          Importar
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 truncate">{r.set_name} • {r.tcg}</div>
                  </div>
                  <ArrowRight size={14} className="text-slate-300 opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
                </button>
              )
            })}
          </div>
          <div className="bg-slate-50 p-2 text-center border-t border-slate-100">
            <button onClick={goToSearch} className="text-xs font-bold text-[#E91E63] hover:underline">
              Ver todos los resultados
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
