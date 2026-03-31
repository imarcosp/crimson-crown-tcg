"use client"
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect } from 'react'
import { Search, Filter, X, ArrowUpDown } from 'lucide-react'

const TCGS = ['Magic', 'Pokémon', 'Lorcana', 'Yu-Gi-Oh!', 'One Piece', 'Star Wars', 'Gundam', 'Riftbound', 'Secret Lair']
const CONDITIONS = ['NM', 'PL', 'HP', 'DMG']
const RARITIES = ['Common', 'Uncommon', 'Rare', 'Mythic', 'Promo']

export default function CatalogFilters() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [setSearch, setSetSearch] = useState(searchParams.get('set') || '')
  const [selectedTcg, setSelectedTcg] = useState(searchParams.get('tcg') || '')
  const [sort, setSort] = useState(searchParams.get('sort') || 'price_desc')
  const [finish, setFinish] = useState(searchParams.get('finish') || 'all')
  const [conditions, setConditions] = useState<string[]>(searchParams.get('cond')?.split(',').filter(Boolean) || [])
  const [rarities, setRarities] = useState<string[]>(searchParams.get('rarity')?.split(',').filter(Boolean) || [])

  useEffect(() => {
    setQuery(searchParams.get('q') || '')
    setSetSearch(searchParams.get('set') || '')
    setSelectedTcg(searchParams.get('tcg') || '')
    setSort(searchParams.get('sort') || 'price_desc')
    setFinish(searchParams.get('finish') || 'all')
    setConditions(searchParams.get('cond')?.split(',').filter(Boolean) || [])
    setRarities(searchParams.get('rarity')?.split(',').filter(Boolean) || [])
  }, [searchParams])

  const applyFilters = (updates: any) => {
    const params = new URLSearchParams(searchParams.toString())
    const updateParam = (key: string, val: any) => {
      if (val && val !== 'all' && val.length !== 0) {
        params.set(key, Array.isArray(val) ? val.join(',') : val)
      } else {
        params.delete(key)
      }
    }
    if ('q' in updates) updateParam('q', updates.q)
    if ('set' in updates) updateParam('set', updates.set)
    if ('tcg' in updates) updateParam('tcg', updates.tcg)
    if ('sort' in updates) updateParam('sort', updates.sort)
    if ('finish' in updates) updateParam('finish', updates.finish)
    if ('cond' in updates) updateParam('cond', updates.cond)
    if ('rarity' in updates) updateParam('rarity', updates.rarity)
    params.set('page', '1')
    router.push(`/catalog?${params.toString()}`)
  }

  const toggleCondition = (c: string) => {
    const newC = conditions.includes(c) ? conditions.filter((x) => x !== c) : [...conditions, c]
    setConditions(newC)
    applyFilters({ cond: newC })
  }

  const toggleRarity = (r: string) => {
    const newR = rarities.includes(r) ? rarities.filter((x) => x !== r) : [...rarities, r]
    setRarities(newR)
    applyFilters({ rarity: newR })
  }

  const handleKeyDown = (e: React.KeyboardEvent, field: string) => {
    if (e.key === 'Enter') {
      if (field === 'set') applyFilters({ set: setSearch })
      if (field === 'q') applyFilters({ q: query })
    }
  }

  const clearAll = () => router.push('/catalog')

  return (
    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[#0F172A] font-bold">
          <Filter size={20} /> <h3>Filtros</h3>
        </div>
        <button onClick={clearAll} className="text-xs text-red-500 hover:underline flex items-center gap-1">
          <X size={12} /> Limpiar
        </button>
      </div>

      <div>
        <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Ordenar por</label>
        <div className="relative">
          <ArrowUpDown className="absolute left-3 top-2.5 text-slate-400" size={16} />
          <select value={sort} onChange={(e) => { setSort(e.target.value); applyFilters({ sort: e.target.value }) }} className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#0F172A] appearance-none bg-white">
            <option value="price_desc">Mayor Precio</option>
            <option value="price_asc">Menor Precio</option>
            <option value="newest">Más Recientes</option>
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Nombre Carta</label>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => handleKeyDown(e, 'q')} onBlur={() => applyFilters({ q: query })} placeholder="Buscar..." className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F172A]" />
        </div>
      </div>

      <div>
        <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Juego (TCG)</label>
        <select value={selectedTcg} onChange={(e) => { setSelectedTcg(e.target.value); applyFilters({ tcg: e.target.value }) }} className="w-full p-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#0F172A] bg-white">
          <option value="">Todos</option>
          {TCGS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Set / Expansión</label>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
          <input value={setSearch} onChange={(e) => setSetSearch(e.target.value)} onKeyDown={(e) => handleKeyDown(e, 'set')} onBlur={() => applyFilters({ set: setSearch })} placeholder={selectedTcg ? `Sets de ${selectedTcg}...` : 'Buscar set...'} className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F172A]" />
        </div>
      </div>

      <div>
        <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Acabado</label>
        <div className="flex gap-2">
          {['all', 'nonfoil', 'foil'].map((f) => (
            <button key={f} onClick={() => { setFinish(f); applyFilters({ finish: f }) }} className={`flex-1 py-1 text-xs rounded border ${finish === f ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`}>
              {f === 'all' ? 'Todos' : f === 'foil' ? 'Foil' : 'Normal'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Estado</label>
        <div className="grid grid-cols-2 gap-2">
          {CONDITIONS.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={conditions.includes(c)} onChange={() => toggleCondition(c)} className="rounded border-slate-300 text-[#0F172A] focus:ring-[#0F172A]" />
              <span className="text-slate-700">{c}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Rareza</label>
        <div className="space-y-1">
          {RARITIES.map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={rarities.includes(r)} onChange={() => toggleRarity(r)} className="rounded border-slate-300 text-[#0F172A] focus:ring-[#0F172A]" />
              <span className="text-slate-700">{r}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
