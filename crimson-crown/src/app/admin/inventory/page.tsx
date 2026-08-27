"use client"
import { useEffect, useState, useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import ProductForm from '@/components/admin/ProductForm'
import CsvUploader from '@/components/admin/CsvUploader'
import { Search, Package, DollarSign, Trash2, Edit, ChevronLeft, ChevronRight, Filter, Tag, EyeOff, Eye } from 'lucide-react'
import InventorySelector from '@/components/admin/InventorySelector'
import type { Inventory } from '@/app/actions/admin-inventories'

const ITEMS_PER_PAGE = 25

export default function InventoryPage() {
  const supabase = createClient()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [inventories, setInventories] = useState<Inventory[]>([])
  const [selectedInventoryId, setSelectedInventoryId] = useState('')
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<any | null>(null)
  const [creating, setCreating] = useState(false)
  const [productToDelete, setProductToDelete] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [view, setView] = useState<'list' | 'csv'>('list')
  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedCategory, setSelectedCategory] = useState('Todas')
  const [showManualOnly, setShowManualOnly] = useState(false) 
  const [showOutOfStock, setShowOutOfStock] = useState(false) 
  const [zoomedImage, setZoomedImage] = useState<string | null>(null)

  const loadInventories = async () => {
    const { data, error } = await supabase
      .from('inventories')
      .select('id,name,description,location_label,kind,is_active,created_at,updated_at,archived_at')
      .order('kind', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) {
      console.error('Error cargando inventarios:', error)
      return
    }
    const available = (data || []) as Inventory[]
    setInventories(available)
    const requested = searchParams.get('inventory')
    const next = available.find((item) => item.id === requested && !item.archived_at)?.id
      || available.find((item) => item.kind === 'primary')?.id
      || available.find((item) => !item.archived_at)?.id
      || ''
    setSelectedInventoryId(next)
  }

  const load = async () => {
    if (!selectedInventoryId) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      let allProducts: any[] = []
      let from = 0
      const PAGE_SIZE = 1000
      let fetchMore = true

      while (fetchMore) {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('inventory_id', selectedInventoryId)
          .order('created_at', { ascending: false })
          .range(from, from + PAGE_SIZE - 1)
        if (error) throw error
        if (data && data.length > 0) {
          allProducts = allProducts.concat(data)
          if (data.length < PAGE_SIZE) fetchMore = false
          else from += PAGE_SIZE
        } else {
          fetchMore = false
        }
      }
      setItems(allProducts)
    } catch (error) {
      console.error('Error cargando inventario:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadInventories() }, [])
  useEffect(() => { void load() }, [selectedInventoryId])
  useEffect(() => { setCurrentPage(1) }, [searchTerm, view, selectedCategory, showManualOnly, showOutOfStock, selectedInventoryId])

  const selectedInventory = inventories.find((inventory) => inventory.id === selectedInventoryId)

  const selectInventory = (id: string) => {
    setSelectedInventoryId(id)
    router.replace(`/admin/inventory?inventory=${encodeURIComponent(id)}`)
  }

  const filteredItems = useMemo(() => {
    let result = items
    
    // Filtro Categoría
    if (selectedCategory !== 'Todas') {
        result = result.filter(i => i.tcg === selectedCategory)
    }
    
    // Filtro Stock 0
    if (!showOutOfStock) {
        result = result.filter(i => (i.stock || 0) > 0)
    }

    // Filtro Manual
    if (showManualOnly) {
        result = result.filter(i => i.is_manual_price === true)
    }

    // Buscador
    if (searchTerm) {
        const lower = searchTerm.toLowerCase()
        result = result.filter(i => (
            (i.name || '').toLowerCase().includes(lower) ||
            (i.set_name || '').toLowerCase().includes(lower)
        ))
    }
    return result
  }, [items, searchTerm, selectedCategory, showManualOnly, showOutOfStock])

  useEffect(() => {
    const visibleIds = new Set(filteredItems.map((item) => item.id))
    setSelectedIds((prev) => prev.filter((id) => visibleIds.has(id)))
  }, [filteredItems])

  const stats = useMemo(() => {
    return filteredItems.reduce((acc, item) => {
      const qty = Number(item.stock || 0)
      const price = Number(item.price_usd || 0)
      acc.count += qty
      acc.value += qty * price
      return acc
    }, { count: 0, value: 0 })
  }, [filteredItems])

  const categoryOptions = useMemo(() => {
    const categories = Array.from(
      new Set(
        items
          .map((item) => String(item.tcg || '').trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b))

    return ['Todas', ...categories]
  }, [items])

  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE
    return filteredItems.slice(start, start + ITEMS_PER_PAGE)
  }, [filteredItems, currentPage])

  const currentPageIds = useMemo(() => paginatedItems.map((item) => item.id), [paginatedItems])
  const allFilteredSelected = filteredItems.length > 0 && filteredItems.every((item) => selectedIds.includes(item.id))
  const allPageSelected = currentPageIds.length > 0 && currentPageIds.every((id) => selectedIds.includes(id))

  const totalPages = Math.ceil(filteredItems.length / ITEMS_PER_PAGE)

  const confirmDelete = async () => {
    if (!productToDelete) return
    const { error } = await supabase.from('products').delete().eq('id', productToDelete).eq('inventory_id', selectedInventoryId)
    if (!error) load()
    setProductToDelete(null)
  }

  const toggleSelectedId = (id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((currentId) => currentId !== id) : [...prev, id])
  }

  const toggleCurrentPageSelection = () => {
    setSelectedIds((prev) => {
      if (allPageSelected) return prev.filter((id) => !currentPageIds.includes(id))
      return Array.from(new Set([...prev, ...currentPageIds]))
    })
  }

  const toggleFilteredSelection = () => {
    const filteredIds = filteredItems.map((item) => item.id)
    setSelectedIds((prev) => {
      if (allFilteredSelected) return prev.filter((id) => !filteredIds.includes(id))
      return Array.from(new Set([...prev, ...filteredIds]))
    })
  }

  const clearSelection = () => setSelectedIds([])

  const confirmBulkDelete = async () => {
    if (selectedIds.length === 0) return
    const { error } = await supabase.from('products').delete().in('id', selectedIds).eq('inventory_id', selectedInventoryId)
    if (!error) {
      setSelectedIds([])
      setBulkDeleteOpen(false)
      load()
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">{selectedInventory?.name || 'Inventario'}</h1>
          <p className="text-slate-500 text-sm">Gestiona stock, precios y cargas de esta fuente de inventario.</p>
        </div>
        {inventories.length > 0 && <InventorySelector inventories={inventories.filter((inventory) => !inventory.archived_at)} selectedId={selectedInventoryId} onChange={selectInventory} />}
        {view === 'list' && (
          <button onClick={() => setCreating(true)} className="rounded-lg bg-[#0F172A] hover:bg-slate-800 text-white px-4 py-2.5 text-sm font-bold shadow-lg shadow-slate-900/10 transition-all flex items-center gap-2 cursor-pointer">+ Nuevo Producto</button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-lg"><Package size={24} /></div>
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Items Visibles</p>
            <p className="text-2xl font-bold text-slate-900">{stats.count.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg"><DollarSign size={24} /></div>
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Valuación Visible</p>
            <p className="text-2xl font-bold text-slate-900">US$ {stats.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col xl:flex-row gap-4 bg-white p-3 rounded-lg border border-slate-200">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md shrink-0">
          <button className={`px-4 py-1.5 rounded text-sm font-bold transition-all ${view === 'list' ? 'bg-white text-[#0F172A] shadow-sm' : 'text-slate-500 hover:text-slate-700'} cursor-pointer`} onClick={() => setView('list')}>Listado</button>
          <button className={`px-4 py-1.5 rounded text-sm font-bold transition-all ${view === 'csv' ? 'bg-white text-[#0F172A] shadow-sm' : 'text-slate-500 hover:text-slate-700'} cursor-pointer`} onClick={() => setView('csv')}>CSV</button>
        </div>
        
        {view === 'list' && (
            <div className="flex flex-col sm:flex-row gap-3 w-full items-center">
                <div className="relative shrink-0 sm:w-40 w-full">
                    <Filter className="absolute left-3 top-2.5 text-slate-400" size={16}/>
                    <select 
                        value={selectedCategory} 
                        onChange={(e) => setSelectedCategory(e.target.value)}
                        className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-md text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-200 appearance-none cursor-pointer hover:bg-slate-100 transition-colors"
                    >
                        {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>

                <div className="flex gap-2 w-full sm:w-auto">
                    <label className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors select-none ${showOutOfStock ? 'bg-purple-50 border-purple-200 text-purple-800' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'}`}>
                        <input 
                            type="checkbox" 
                            checked={showOutOfStock} 
                            onChange={(e) => setShowOutOfStock(e.target.checked)}
                            className="hidden"
                        />
                        {showOutOfStock ? <Eye size={16}/> : <EyeOff size={16}/>}
                        <span className="text-sm font-bold">{showOutOfStock ? 'Ocultar Sin Stock' : 'Ver Sin Stock'}</span>
                    </label>

                    <label className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors select-none ${showManualOnly ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'}`}>
                        <input 
                            type="checkbox" 
                            checked={showManualOnly} 
                            onChange={(e) => setShowManualOnly(e.target.checked)}
                            className="hidden"
                        />
                        <Tag size={16}/>
                        <span className="text-sm font-bold">Manuales</span>
                    </label>
                </div>

                <div className="relative w-full">
                    <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                    <input type="text" placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-slate-200 focus:bg-white transition-all" />
                </div>
            </div>
        )}
      </div>

      {view === 'list' && filteredItems.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-lg border border-slate-200">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={toggleCurrentPageSelection} className="px-3 py-1.5 rounded-md border border-slate-200 bg-slate-50 text-sm font-bold text-slate-700 hover:bg-slate-100 transition-colors">
              {allPageSelected ? 'Deseleccionar página' : 'Seleccionar página'}
            </button>
            <button onClick={toggleFilteredSelection} className="px-3 py-1.5 rounded-md border border-slate-200 bg-slate-50 text-sm font-bold text-slate-700 hover:bg-slate-100 transition-colors">
              {allFilteredSelected ? 'Deseleccionar filtrados' : 'Seleccionar filtrados'}
            </button>
            {selectedIds.length > 0 && (
              <button onClick={clearSelection} className="px-3 py-1.5 rounded-md border border-slate-200 bg-white text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors">
                Limpiar selección
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">
              Seleccionados: <span className="font-bold text-slate-800">{selectedIds.length}</span>
            </span>
            <button
              onClick={() => setBulkDeleteOpen(true)}
              disabled={selectedIds.length === 0}
              className="px-4 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              <Trash2 size={16} /> Eliminar seleccionados
            </button>
          </div>
        </div>
      )}

      {view === 'list' ? (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm flex flex-col h-full">
          {loading ? (
            <div className="p-12 text-center text-slate-500 flex flex-col items-center gap-2"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-slate-900"></div>Cargando inventario...</div>
          ) : filteredItems.length === 0 ? (
            <div className="p-12 text-center text-slate-500">{searchTerm || selectedCategory !== 'Todas' || showManualOnly ? 'No se encontraron productos con esos filtros.' : 'Tu inventario está vacío.'}</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs">
                    <tr>
                      <th className="px-4 py-3 text-center">
                        <input type="checkbox" checked={allPageSelected} onChange={toggleCurrentPageSelection} className="h-4 w-4 rounded border-slate-300 text-[#9D1B1B] focus:ring-[#9D1B1B]" />
                      </th>
                      <th className="px-4 py-3">Imagen</th>
                      <th className="px-4 py-3">Detalle</th>
                      <th className="px-4 py-3 text-center">Estado</th>
                      <th className="px-4 py-3 text-center">Idioma</th>
                      <th className="px-4 py-3">Acabado</th>
                      <th className="px-4 py-3 text-right">Precio</th>
                      <th className="px-4 py-3 text-center">Stock</th>
                      <th className="px-4 py-3 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedItems.map((it) => (
                      <tr key={it.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2 text-center">
                          <input type="checkbox" checked={selectedIds.includes(it.id)} onChange={() => toggleSelectedId(it.id)} className="h-4 w-4 rounded border-slate-300 text-[#9D1B1B] focus:ring-[#9D1B1B]" />
                        </td>
                        <td className="px-4 py-2">
                          {it.image_url ? (
                            <div 
                              className="h-12 w-9 rounded overflow-hidden border border-slate-200 relative group cursor-zoom-in"
                              onClick={() => setZoomedImage(it.image_url)}
                            >
                              <img src={it.image_url} alt={it.name} className="absolute inset-0 w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors"></div>
                            </div>
                          ) : (
                            <div className="h-12 w-9 bg-slate-200 rounded flex items-center justify-center text-[8px] text-slate-400">Sin img</div>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <div className="font-bold text-slate-800">{it.name}</div>
                          <div className="text-xs text-slate-500">{it.set_name} {it.collector_number ? `#${it.collector_number}` : ''}</div>
                        </td>
                        <td className="px-4 py-2 text-center">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${it.condition === 'NM' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
                                {it.condition || 'NM'}
                            </span>
                        </td>
                        <td className="px-4 py-2 text-center">
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100 uppercase">
                                {it.language ? it.language.substring(0,3) : 'EN'}
                            </span>
                        </td>
                        <td className="px-4 py-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded border ${String(it.finish).includes('Foil') && !String(it.finish).includes('Non') ? 'bg-purple-50 text-purple-700 border-purple-100' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                            {it.finish || 'Normal'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-slate-700">
                            {it.is_manual_price && <span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-2" title="Precio Manual"></span>}
                            US$ {Number(it.price_usd || 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <span className={`px-2 py-0.5 rounded font-bold text-xs ${it.stock > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>{it.stock}</span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => setEditing(it)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors cursor-pointer" title="Editar"><Edit size={16} /></button>
                            <button onClick={() => setProductToDelete(it.id)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer" title="Eliminar"><Trash2 size={16} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50/50">
                <span className="text-xs text-slate-500">
                  Mostrando <span className="font-bold">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span> a <span className="font-bold">{Math.min(currentPage * ITEMS_PER_PAGE, filteredItems.length)}</span> de <span className="font-bold">{filteredItems.length}</span> resultados
                </span>
                <div className="flex items-center gap-2">
                   <button onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} disabled={currentPage === 1} className="p-1 rounded bg-white border border-slate-300 disabled:opacity-50 hover:bg-slate-50 cursor-pointer"><ChevronLeft size={16}/></button> 
                   <span className="text-xs font-bold text-slate-700">Pág {currentPage} de {totalPages}</span> 
                   <button onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} disabled={currentPage >= totalPages} className="p-1 rounded bg-white border border-slate-300 disabled:opacity-50 hover:bg-slate-50 cursor-pointer"><ChevronRight size={16}/></button> 
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        selectedInventoryId && <CsvUploader inventoryId={selectedInventoryId} />
      )}

      {creating && selectedInventoryId && <ProductForm inventoryId={selectedInventoryId} initial={null} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void load() }} />}
      {editing && selectedInventoryId && <ProductForm inventoryId={selectedInventoryId} initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />}

      {zoomedImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 animate-in fade-in duration-200" onClick={() => setZoomedImage(null)}>
          <img src={zoomedImage} alt="Zoom" className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl" />
        </div>
      )}

      {productToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl border border-slate-200 p-6 animate-in fade-in zoom-in duration-200">
            <h3 className="text-lg font-bold text-[#0F172A] mb-2">Confirmar eliminación</h3>
            <p className="text-sm text-slate-600 mb-6">Estás a punto de borrar <span className="font-bold text-slate-900">\"{items.find((i) => i.id === productToDelete)?.name}\"</span>. Esta acción no se puede deshacer.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setProductToDelete(null)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 transition-colors">Cancelar</button>
              <button onClick={confirmDelete} className="px-4 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700 transition-colors shadow-lg shadow-red-900/20">Sí, eliminar</button>
            </div>
          </div>
        </div>
      )}

      {bulkDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl border border-slate-200 p-6 animate-in fade-in zoom-in duration-200">
            <h3 className="text-lg font-bold text-[#0F172A] mb-2">Confirmar eliminación masiva</h3>
            <p className="text-sm text-slate-600 mb-6">
              Estás a punto de borrar <span className="font-bold text-slate-900">{selectedIds.length}</span> productos seleccionados. Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setBulkDeleteOpen(false)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 transition-colors">Cancelar</button>
              <button onClick={confirmBulkDelete} className="px-4 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700 transition-colors shadow-lg shadow-red-900/20">Sí, eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
