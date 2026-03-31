"use client"
import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Filter as FilterIcon, ChevronDown, ChevronUp, X, Search, Loader2 } from 'lucide-react'
import Image from 'next/image'

// TCGs Limpios
const TCGS = ['Magic', 'Riftbound']
const RARITIES = ['Common', 'Uncommon', 'Rare', 'Mythic']
const CONDITIONS = ['NM', 'PL', 'HP', 'DMG']

export default function FilterSidebar() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isOpen, setIsOpen] = useState(false) // Mobile toggle
  
  // Lógica de Sets
  const [sets, setSets] = useState<any[]>([])
  const [setSearch, setSetSearch] = useState('')
  const [loadingSets, setLoadingSets] = useState(false)
  const [showSetDropdown, setShowSetDropdown] = useState(false)

  // Cargar Sets al iniciar (solo una vez)
  useEffect(() => {
      const fetchSets = async () => {
          setLoadingSets(true)
          try {
              // Obtenemos solo los sets principales de Magic para no saturar
              const res = await fetch('https://api.scryfall.com/sets?type=expansion,core,masters')
              const data = await res.json()
              if (data.data) {
                  setSets(data.data)
              }
          } catch (e) {
              console.error("Error fetching sets", e)
          } finally {
              setLoadingSets(false)
          }
      }
      fetchSets()
  }, [])

  const updateFilter = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value === null) params.delete(key)
    else {
        if (key === 'finish' || key === 'set') { // Set y Finish son únicos
            params.set(key, value)
        } else { // Los demás son acumulativos
            const current = params.get(key)?.split(',') || []
            if (current.includes(value)) {
                const next = current.filter(c => c !== value)
                if (next.length > 0) params.set(key, next.join(','))
                else params.delete(key)
            } else {
                current.push(value)
                params.set(key, current.join(','))
            }
        }
    }
    params.delete('page')
    router.push(`/catalog?${params.toString()}`, { scroll: false })
  }

  const clearFilters = () => router.push('/catalog', { scroll: false })
  const getActive = (key: string) => searchParams.get(key)?.split(',') || []
  const hasFilter = (key: string, val: string) => getActive(key).includes(val)

  // Filtrado local de sets
  const filteredSets = sets.filter(s => s.name.toLowerCase().includes(setSearch.toLowerCase())).slice(0, 10)

  return (
    <aside className="w-full bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6 md:mb-0 h-fit">
      {/* Mobile Toggle */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 md:cursor-default md:pointer-events-none bg-slate-50 md:bg-white"
      >
        <div className="flex items-center gap-2 font-bold text-slate-800">
          <FilterIcon size={20} className="text-[#E91E63]" />
          <span>Filtros</span>
        </div>
        <div className="md:hidden text-slate-500">
          {isOpen ? <ChevronUp /> : <ChevronDown />}
        </div>
      </button>

      <div className={`p-5 border-t border-slate-100 ${isOpen ? 'block' : 'hidden'} md:block space-y-6`}>
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-[#0F172A] text-sm uppercase tracking-wider">Opciones</h3>
          <button onClick={clearFilters} className="text-xs text-red-500 font-bold hover:underline flex items-center gap-1">
            <X size={12}/> Limpiar
          </button>
        </div>

        {/* TCG */}
        <div>
          <h4 className="font-bold text-slate-900 mb-3 text-sm">Juego (TCG)</h4>
          <div className="space-y-2">
            {TCGS.map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm text-slate-600 hover:text-[#E91E63] cursor-pointer transition-colors group">
                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${hasFilter('tcg', t) ? 'bg-[#E91E63] border-[#E91E63]' : 'border-slate-300 group-hover:border-[#E91E63]'}`}>
                    {hasFilter('tcg', t) && <div className="w-2 h-2 bg-white rounded-full"/>}
                </div>
                <input type="checkbox" className="hidden" checked={hasFilter('tcg', t)} onChange={() => updateFilter('tcg', t)} />
                {t}
              </label>
            ))}
          </div>
        </div>

        <hr className="border-slate-100"/>

        {/* SETS (NUEVO) */}
        <div className="relative">
            <h4 className="font-bold text-slate-900 mb-3 text-sm">Set / Expansión</h4>
            <div className="relative">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
                <input 
                    value={setSearch} 
                    onChange={(e) => { setSetSearch(e.target.value); setShowSetDropdown(true) }}
                    onFocus={() => setShowSetDropdown(true)}
                    placeholder="Buscar set..." 
                    className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F172A]" 
                />
                {searchParams.get('set') && (
                    <button onClick={() => { updateFilter('set', null); setSetSearch('') }} className="absolute right-2 top-2 text-slate-400 hover:text-red-500">
                        <X size={14}/>
                    </button>
                )}
            </div>
            
            {showSetDropdown && (setSearch.length > 0 || loadingSets) && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-20 max-h-48 overflow-y-auto">
                    {loadingSets ? (
                        <div className="p-3 text-center"><Loader2 className="animate-spin mx-auto w-4 h-4 text-[#E91E63]"/></div>
                    ) : filteredSets.length > 0 ? (
                        filteredSets.map((s) => (
                            <button 
                                key={s.code} 
                                onClick={() => { updateFilter('set', s.name); setSetSearch(s.name); setShowSetDropdown(false) }}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-center gap-2 truncate"
                            >
                                <img src={s.icon_svg_uri} alt="" className="w-4 h-4 opacity-70" />
                                <span className="truncate">{s.name}</span>
                            </button>
                        ))
                    ) : (
                        <div className="p-2 text-xs text-center text-slate-400">No se encontraron sets</div>
                    )}
                </div>
            )}
            
            {/* Click outside closer overlay */}
            {showSetDropdown && <div className="fixed inset-0 z-10" onClick={() => setShowSetDropdown(false)} />}
        </div>

        {/* Acabado (Foil) */}
        <div>
          <h4 className="font-bold text-slate-900 mb-3 text-sm">Acabado</h4>
          <div className="flex p-1 bg-slate-100 rounded-lg">
            {[
                { label: 'Todos', val: null },
                { label: 'Normal', val: 'nonfoil' },
                { label: 'Foil', val: 'foil' }
            ].map((opt) => {
                const isActive = (!searchParams.get('finish') && opt.val === null) || searchParams.get('finish') === opt.val
                return (
                    <button
                        key={opt.label}
                        onClick={() => updateFilter('finish', opt.val)}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${isActive ? 'bg-white text-[#E91E63] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        {opt.label}
                    </button>
                )
            })}
          </div>
        </div>

        {/* Rareza */}
        <div>
          <h4 className="font-bold text-slate-900 mb-3 text-sm">Rareza</h4>
          <div className="space-y-2">
            {RARITIES.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm text-slate-600 hover:text-[#E91E63] cursor-pointer group">
                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${hasFilter('rarity', r) ? 'bg-[#E91E63] border-[#E91E63]' : 'border-slate-300 group-hover:border-[#E91E63]'}`}>
                    {hasFilter('rarity', r) && <div className="w-2 h-2 bg-white rounded-full"/>}
                </div>
                <input type="checkbox" className="hidden" checked={hasFilter('rarity', r)} onChange={() => updateFilter('rarity', r)} />
                {r}
              </label>
            ))}
          </div>
        </div>

        {/* Estado */}
        <div>
            <h4 className="font-bold text-slate-900 mb-3 text-sm">Estado</h4>
            <div className="flex flex-wrap gap-2">
                {CONDITIONS.map((c) => (
                <label key={c} className={`px-2.5 py-1 rounded text-xs font-bold border cursor-pointer transition-all ${hasFilter('condition', c) ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
                    <input type="checkbox" className="hidden" checked={hasFilter('condition', c)} onChange={() => updateFilter('condition', c)} />
                    {c}
                </label>
                ))}
            </div>
        </div>

      </div>
    </aside>
  )
}