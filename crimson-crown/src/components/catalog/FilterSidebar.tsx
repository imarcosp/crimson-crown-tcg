"use client"
import { useState, useEffect, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Filter as FilterIcon, ChevronDown, ChevronUp, X, Search, Loader2 } from 'lucide-react'
import { MAGIC_FORMAT_OPTIONS, parsePriceRange } from '@/lib/catalog/magic-filters'

const RARITIES = ['Common', 'Uncommon', 'Rare', 'Mythic']
const CONDITIONS = ['NM', 'PL', 'HP', 'DMG']
const COLOR_OPTIONS = [
  { code: 'W', label: 'Blanco', chip: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-100 text-amber-700' },
  { code: 'U', label: 'Azul', chip: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-100 text-blue-700' },
  { code: 'B', label: 'Negro', chip: 'bg-slate-100 text-slate-700 border-slate-300', dot: 'bg-slate-700 text-white' },
  { code: 'R', label: 'Rojo', chip: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-100 text-rose-700' },
  { code: 'G', label: 'Verde', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-100 text-emerald-700' },
  { code: 'C', label: 'Incoloro', chip: 'bg-zinc-100 text-zinc-700 border-zinc-300', dot: 'bg-zinc-100 text-zinc-700' },
  { code: 'M', label: 'Multicolor', chip: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200', dot: 'bg-fuchsia-100 text-fuchsia-700' },
]

type ScryfallSetOption = {
  code: string
  name: string
  icon_svg_uri?: string
}

type FilterSidebarProps = {
  activeCategory?: string
}

export default function FilterSidebar({ activeCategory = '' }: FilterSidebarProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isOpen, setIsOpen] = useState(false) // Mobile toggle
  
  // Lógica de Sets
  const [sets, setSets] = useState<ScryfallSetOption[]>([])
  const [setSearch, setSetSearch] = useState('')
  const [loadingSets, setLoadingSets] = useState(false)
  const [showSetDropdown, setShowSetDropdown] = useState(false)
  const [priceError, setPriceError] = useState('')
  const showMagicCardFilters = activeCategory === 'Magic'

  // Cargar Sets al iniciar (solo una vez)
  useEffect(() => {
      if (!showMagicCardFilters) {
          setSets([])
          setSetSearch('')
          setShowSetDropdown(false)
          return
      }

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
  }, [showMagicCardFilters])

  const updateFilter = (key: string, value: string | null) => {
    setPriceError('')
    const params = new URLSearchParams(searchParams.toString())
    if (value === null) params.delete(key)
    else {
      if (key === 'finish' || key === 'set' || key === 'sort' || key === 'basicLand' || key === 'format') {
        params.set(key, value)
      } else {
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

  const applyPriceRange = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const rawMin = String(form.get('priceMin') || '').trim()
    const rawMax = String(form.get('priceMax') || '').trim()
    const range = parsePriceRange(rawMin, rawMax)

    if (!range.isValid) {
      setPriceError('Ingresa valores positivos y asegúrate de que el mínimo no supere al máximo.')
      return
    }

    const params = new URLSearchParams(searchParams.toString())
    if (range.min === null) params.delete('priceMin')
    else params.set('priceMin', String(range.min))
    if (range.max === null) params.delete('priceMax')
    else params.set('priceMax', String(range.max))
    params.delete('page')
    setPriceError('')
    router.push(`/catalog?${params.toString()}`, { scroll: false })
  }

  return (
    <aside className="w-full bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6 md:mb-0 h-fit">
      {/* Mobile Toggle */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 md:cursor-default md:pointer-events-none bg-slate-50 md:bg-white"
      >
        <div className="flex items-center gap-2 font-bold text-slate-800">
          <FilterIcon size={20} className="text-[#9D1B1B]" />
          <span>Filtros</span>
        </div>
        <div className="md:hidden text-slate-500">
          {isOpen ? <ChevronUp /> : <ChevronDown />}
        </div>
      </button>

      <div className={`p-5 border-t border-slate-100 ${isOpen ? 'block' : 'hidden'} md:block space-y-6`}>
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-[#1C1B22] text-sm uppercase tracking-wider">Opciones</h3>
          <button onClick={clearFilters} className="text-xs text-red-500 font-bold hover:underline flex items-center gap-1">
            <X size={12}/> Limpiar
          </button>
        </div>

        <div>
          <h4 className="font-bold text-slate-900 mb-3 text-sm">Ordenar por</h4>
          <div className="relative">
            <select
              value={searchParams.get('sort') || 'price_desc'}
              onChange={(e) => updateFilter('sort', e.target.value)}
              className="w-full border border-slate-200 rounded-lg p-2.5 text-sm text-slate-700 bg-slate-50 focus:ring-2 focus:ring-[#E91E63] focus:border-transparent outline-none appearance-none cursor-pointer"
            >
              <option value="price_desc">Mayor a menor precio</option>
              <option value="price_asc">Menor a mayor precio</option>
              <option value="newest">Más recientes</option>
              <option value="alpha">Orden alfabético</option>
            </select>
            <div className="absolute right-3 top-3 pointer-events-none text-slate-400">
              <ChevronDown size={16} />
            </div>
          </div>
        </div>

        {showMagicCardFilters && (
          <>
            <hr className="border-slate-100"/>

            <div>
              <h4 className="font-bold text-slate-900 mb-3 text-sm">Colores</h4>
              <div className="flex flex-wrap gap-2">
                {COLOR_OPTIONS.map((color) => {
                  const active = hasFilter('colors', color.code)
                  return (
                    <button
                      key={color.code}
                      type="button"
                      onClick={() => updateFilter('colors', active ? null : color.code)}
                      className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold cursor-pointer transition-colors ${
                        active ? color.chip : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <span className="inline-flex items-center gap-2">
                        <span className={`relative flex h-5 w-5 items-center justify-center rounded-full overflow-hidden border border-black/5 shadow-sm ${color.dot}`}>
                          <img
                            src={`/icons/mana/${color.code}.svg`}
                            alt={color.code}
                            className="absolute inset-0 h-full w-full object-contain"
                            onError={(event) => { (event.currentTarget as HTMLImageElement).style.display = 'none' }}
                          />
                          <span className="text-[10px] font-extrabold">{color.code}</span>
                        </span>
                        <span>{color.label}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={() => updateFilter('basicLand', searchParams.get('basicLand') === 'true' ? null : 'true')}
                className={`w-full text-sm py-2 font-bold rounded-lg border transition-colors flex items-center justify-center gap-2 cursor-pointer ${
                  searchParams.get('basicLand') === 'true'
                    ? 'bg-[#E91E63] text-white border-[#E91E63] shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                Solo tierras básicas
              </button>
            </div>

            <hr className="border-slate-100"/>

            <div>
              <h4 className="font-bold text-slate-900 mb-3 text-sm">Precio (US$)</h4>
              <form
                key={`${searchParams.get('priceMin') || ''}:${searchParams.get('priceMax') || ''}`}
                onSubmit={applyPriceRange}
                className="space-y-2"
              >
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs font-medium text-slate-600">
                    Mínimo
                    <input
                      name="priceMin"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      defaultValue={searchParams.get('priceMin') || ''}
                      placeholder="0"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#E91E63]"
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Máximo
                    <input
                      name="priceMax"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      defaultValue={searchParams.get('priceMax') || ''}
                      placeholder="Sin límite"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#E91E63]"
                    />
                  </label>
                </div>
                {priceError && <p role="alert" className="text-xs text-red-600">{priceError}</p>}
                <button
                  type="submit"
                  className="w-full rounded-lg border border-slate-200 bg-white py-2 text-xs font-bold text-slate-700 transition-colors hover:border-[#9D1B1B] hover:text-[#9D1B1B]"
                >
                  Aplicar precio
                </button>
              </form>
            </div>

            <div>
              <h4 className="font-bold text-slate-900 mb-3 text-sm">Formato</h4>
              <div className="relative">
                <select
                  value={searchParams.get('format') || ''}
                  onChange={(event) => updateFilter('format', event.target.value || null)}
                  className="w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-sm text-slate-700 outline-none focus:border-transparent focus:ring-2 focus:ring-[#E91E63]"
                  aria-label="Formato de Magic"
                >
                  <option value="">Todos los formatos</option>
                  {MAGIC_FORMAT_OPTIONS.map((format) => (
                    <option key={format.value} value={format.value}>{format.label}</option>
                  ))}
                </select>
                <ChevronDown size={16} className="pointer-events-none absolute right-3 top-3 text-slate-400" />
              </div>
            </div>

            <hr className="border-slate-100"/>

            <div className="relative">
                <h4 className="font-bold text-slate-900 mb-3 text-sm">Set / Expansión</h4>
                <div className="relative">
                    <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
                    <input 
                        value={setSearch} 
                        onChange={(e) => { setSetSearch(e.target.value); setShowSetDropdown(true) }}
                        onFocus={() => setShowSetDropdown(true)}
                        placeholder="Buscar set..." 
                        className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1C1B22]" 
                    />
                    {searchParams.get('set') && (
                        <button onClick={() => { updateFilter('set', null); setSetSearch('') }} className="absolute right-2 top-2 text-slate-400 hover:text-red-500 cursor-pointer">
                            <X size={14}/>
                        </button>
                    )}
                </div>
                
                {showSetDropdown && (setSearch.length > 0 || loadingSets) && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-20 max-h-48 overflow-y-auto">
                        {loadingSets ? (
                            <div className="p-3 text-center"><Loader2 className="animate-spin mx-auto w-4 h-4 text-[#9D1B1B]"/></div>
                        ) : filteredSets.length > 0 ? (
                            filteredSets.map((s) => (
                                <button 
                                    key={s.code} 
                                    onClick={() => { updateFilter('set', s.name); setSetSearch(s.name); setShowSetDropdown(false) }}
                                    className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-center gap-2 truncate cursor-pointer"
                                >
                                    {s.icon_svg_uri ? <img src={s.icon_svg_uri} alt="" className="w-4 h-4 opacity-70" /> : null}
                                    <span className="truncate">{s.name}</span>
                                </button>
                            ))
                        ) : (
                            <div className="p-2 text-xs text-center text-slate-400">No se encontraron sets</div>
                        )}
                    </div>
                )}
                
                {showSetDropdown && <div className="fixed inset-0 z-10" onClick={() => setShowSetDropdown(false)} />}
            </div>
          </>
        )}

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
                        className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${isActive ? 'bg-white text-[#9D1B1B] shadow-sm' : 'text-slate-500 hover:text-slate-700'} cursor-pointer`}
                    >
                        {opt.label}
                    </button>
                )
            })}
          </div>
        </div>

        {showMagicCardFilters && (
          <>
            <div>
              <h4 className="font-bold text-slate-900 mb-3 text-sm">Rareza</h4>
              <div className="space-y-2">
                {RARITIES.map((r) => (
                  <label key={r} className="flex items-center gap-2 text-sm text-slate-600 hover:text-[#9D1B1B] cursor-pointer group">
                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${hasFilter('rarity', r) ? 'bg-[#9D1B1B] border-[#9D1B1B]' : 'border-slate-300 group-hover:border-[#9D1B1B]'}`}>
                        {hasFilter('rarity', r) && <div className="w-2 h-2 bg-white rounded-full"/>}
                    </div>
                    <input type="checkbox" className="hidden" checked={hasFilter('rarity', r)} onChange={() => updateFilter('rarity', r)} />
                    {r}
                  </label>
                ))}
              </div>
            </div>

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
          </>
        )}
      </div>
    </aside>
  )
}
