"use client"

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Loader2, ArrowRight, Sparkles } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { createClient } from '@/lib/supabase/client'
import Image from 'next/image'

export default function SearchInput() {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
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

  // Búsqueda en tiempo real
  useEffect(() => {
    if (term.length < 3) {
        setResults([])
        return
    }
    
    // Si es un link de Moxfield, no buscamos en catálogo, esperamos submit
    if (term.includes('moxfield.com/decks/')) {
        setResults([])
        return
    }
    
    const timer = setTimeout(async () => {
        setLoading(true)
        try {
            const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`)
            if (res.ok) {
                const data = await res.json()
                setResults(data.slice(0, 8)) // Aumentamos límite sugerencias
                setShowSuggestions(true)
            }
        } catch (error) {
            console.error(error)
        } finally {
            setLoading(false)
        }
    }, 400)

    return () => clearTimeout(timer)
  }, [term])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const query = term.trim()
    if (!query) return

    // DETECCIÓN INTELIGENTE DE MOXFIELD
    if (query.includes('moxfield.com/decks/')) {
        // Redirigir a la herramienta de importación con el deck cargado
        // Nota: MoxfieldPage deberá leer el parametro ?deck=...
        router.push(`/tools/moxfield?deck=${encodeURIComponent(query)}`)
        setTerm('')
        setShowSuggestions(false)
        inputRef.current?.blur()
        return
    }

    router.push(`/catalog?q=${encodeURIComponent(query)}`)
    setSearchQuery(query)
    setShowSuggestions(false)
    setTerm('')
    inputRef.current?.blur()

    try { await supabase.from('search_logs').insert({ query }) } catch {}
  }

  const handleSelect = (name: string) => {
      setTerm('')
      setSearchQuery(name)
      router.push(`/catalog?q=${encodeURIComponent(name)}`)
      setShowSuggestions(false)
  }

  return (
    <div ref={containerRef} className="relative w-full text-slate-600">
      <form onSubmit={handleSubmit} className="relative">
        <input
          ref={inputRef}
          type="search"
          name="search"
          placeholder="Busca la carta que necesites o pegá tu link de moxfield"
          className="bg-white h-10 px-5 pr-10 rounded-full text-sm focus:outline-none w-full border border-slate-200 focus:border-[#E91E63] transition-colors shadow-sm placeholder:text-slate-400"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onFocus={() => { if(term.length >= 3 && results.length > 0) setShowSuggestions(true) }}
          autoComplete="off"
        />
        <button
          type="submit"
          className="absolute right-0 top-0 mt-2 mr-3 text-slate-400 hover:text-[#E91E63] transition-colors"
          aria-label="Buscar"
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin"/> : <Search className="h-5 w-5" />}
        </button>
      </form>

      {showSuggestions && results.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="p-2">
                  <div className="text-[10px] font-bold text-slate-400 uppercase px-2 mb-1">Sugerencias</div>
                  {results.map((r, idx) => {
                      const finish = (r.finish || '').toLowerCase()
                      const isFoil = (finish.includes('foil') && !finish.includes('non')) || finish.includes('etched')
                      const finishLabel = (r.finish || 'Foil').toUpperCase().replace('NON-FOIL', '').trim() || 'FOIL'
                      
                      return (
                      <button 
                        key={`${r.name}-${r.set_name}-${r.collector_number || ''}-${(r.finish || '').toLowerCase() || (Array.isArray(r.finishes) ? r.finishes[0] : '')}-${idx}`} 
                        onClick={() => handleSelect(r.name)}
                        className="w-full flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg transition-colors text-left group"
                      >
                          <div className="w-8 h-11 bg-slate-200 rounded overflow-hidden shrink-0 border border-slate-200">
                              {r.image_url ? <Image src={r.image_url} alt="" width={32} height={44} className="object-cover w-full h-full" unoptimized /> : null}
                          </div>
                          <div className="flex-1 min-w-0">
                              <div className="font-bold text-sm text-slate-800 truncate group-hover:text-[#E91E63] transition-colors flex items-center gap-1">
                                {r.name}
                                {/* ETIQUETA VISUAL FOIL */}
                                {isFoil && <span className="text-[10px] text-purple-600 bg-purple-50 px-1.5 rounded border border-purple-100 font-bold flex items-center gap-0.5"><Sparkles size={8}/> {finishLabel}</span>}
                                
                                {/* Badge si no hay stock (Ni normal ni foil) */}
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
                  )})} 
              </div>
              <div className="bg-slate-50 p-2 text-center border-t border-slate-100">
                  <button onClick={handleSubmit} className="text-xs font-bold text-[#E91E63] hover:underline">
                      Ver todos los resultados
                  </button>
              </div>
          </div>
      )}
    </div>
  )
}