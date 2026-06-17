'use client'
import { useEffect, useMemo, useState, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Trash2, X, ZoomIn, Search, Loader2, Plus, Save, Send, FileText } from 'lucide-react'
import { getAdminBuylistDetail, saveAdminManualBuylistQuote } from '@/app/actions/admin-buylists'

export default function AdminBuylistDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const supabase = createClient()
  const router = useRouter()
  const [order, setOrder] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [items, setItems] = useState<any[]>([])
  const [loadingAction, setLoadingAction] = useState(false)
  const [zoomedImage, setZoomedImage] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)

  const isManualQuote = Boolean(order?.created_by_admin_id)
  const manualStatus = String(order?.status || '').toLowerCase()
  const isManualEditable = isManualQuote && !['completed', 'rejected', 'cancelled'].includes(manualStatus)
  const total = useMemo(
    () => items.reduce((acc: number, item: any) => acc + Number(item.offered_price_unit || 0) * Math.max(1, Number(item.quantity || 1)), 0),
    [items]
  )

  useEffect(() => {
    const fetchOrder = async () => {
      const result = await getAdminBuylistDetail(id)

      if (!result?.success || !result.order) {
        setLoadError(result?.error || 'No se pudo cargar la cotización.')
        alert('Error cargando orden: ' + (result?.error || 'No se pudo cargar la cotización.'))
      } else {
        setLoadError(null)
        setOrder(result.order)
        setItems((result.order?.buylist_items || []).map((item: any) => ({ ...item })))
      }

      setLoading(false)
    }

    fetchOrder()
  }, [id])

  useEffect(() => {
    if (!isManualEditable) return

    const term = searchQuery.trim()
    if (term.length < 3) {
      setSearchResults([])
      return
    }

    const ctrl = new AbortController()
    setSearching(true)
    fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
      .then((response) => response.json())
      .then((data) => setSearchResults(Array.isArray(data) ? data.slice(0, 8) : []))
      .catch(() => setSearchResults([]))
      .finally(() => setSearching(false))

    return () => ctrl.abort()
  }, [searchQuery, isManualEditable])

  const getProduct = (item: any) => {
    if (Array.isArray(item?.products)) return item.products[0] || null
    return item?.products || null
  }

  const getItemImage = (item: any) => {
    const product = getProduct(item)
    return item?.image_url || product?.image_url || null
  }

  const getItemMarketUnitPrice = (item: any) => {
    const product = getProduct(item)
    const normal = Number(product?.price_usd || 0)
    const foil = Number(product?.price_usd_foil || 0)
    if (Boolean(item?.is_foil)) return foil > 0 ? foil : normal
    return normal > 0 ? normal : foil
  }

  const getStatusLabel = (status: string) => {
    if (status === 'draft') return 'Borrador'
    if (status === 'pending_review') return 'En Revisión'
    if (status === 'waiting_user_approval') return 'Esperando Usuario'
    if (status === 'completed') return 'Completada'
    if (status === 'rejected') return 'Rechazada'
    if (status === 'cancelled') return 'Cancelada'
    return status
  }

  const updateItem = (idx: number, patch: Partial<any>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  const addCardToManualQuote = (result: any) => {
    const normal = Number(result?.price_usd ?? result?.priceUsd ?? 0)
    const foil = Number(result?.price_usd_foil ?? result?.priceUsdFoil ?? 0)
    const finish = String(result?.finish || '').toLowerCase()
    const forcedFoil = ((finish.includes('foil') && !finish.includes('non')) || finish.includes('etched') || finish.includes('holo')) && foil > 0 && normal <= 0
    const baseReference = forcedFoil ? (foil > 0 ? foil : normal) : (normal > 0 ? normal : foil)

    setItems((prev) => [
      {
        id: `${String(result.id)}-${Date.now()}`,
        product_id: String(result.id),
        scryfall_id: result.scryfall_id || null,
        card_name: result.name,
        name: result.name,
        set_name: result.set_name || null,
        image_url: result.image_url || null,
        collector_number: result.collector_number || null,
        quantity: 1,
        condition: 'NM',
        is_foil: forcedFoil,
        offered_price_unit: Number((baseReference * 0.75).toFixed(2)),
        products: {
          id: result.id,
          image_url: result.image_url || null,
          price_usd: normal,
          price_usd_foil: foil,
          finish: result.finish || null,
          language: result.language || null,
        },
      },
      ...prev,
    ])
    setSearchQuery('')
    setSearchResults([])
  }

  const deleteItem = async (itemId: number | string, idx: number) => {
    if (!confirm('¿Eliminar esta carta de la solicitud?')) return

    if (isManualQuote) {
      setItems((prev) => prev.filter((_, index) => index !== idx))
      return
    }

    const { error } = await supabase.from('buylist_items').delete().eq('id', itemId)

    if (error) {
      alert('Error al eliminar: ' + error.message)
    } else {
      setItems((prev) => prev.filter((_, index) => index !== idx))
    }
  }

  const persistManualQuote = async (sendToUser: boolean) => {
    setLoadingAction(true)

    const payload = items.map((item: any) => ({
      id: String(item.product_id || item.id || ''),
      name: String(item.card_name || item.name || '').trim(),
      image_url: getItemImage(item),
      set_name: item.set_name || null,
      collector_number: item.collector_number || null,
      scryfall_id: item.scryfall_id || null,
      quantity: Math.max(1, Number(item.quantity || 1)),
      isFoil: Boolean(item.is_foil),
      condition: String(item.condition || 'NM'),
      offered_price_unit: Math.max(0, Number(item.offered_price_unit || 0)),
    }))

    const result = await saveAdminManualBuylistQuote({ orderId: id, items: payload, sendToUser })
    setLoadingAction(false)

    if (!result?.success) {
      alert(result?.error || 'No se pudo guardar la cotización.')
      return
    }

    setOrder((prev: any) => prev ? { ...prev, status: result.status, total_offered: result.totalOffered, sent_at: result.sentAt } : prev)
    if (sendToUser && result?.emailWarning) {
      alert(`⚠️ Cotización enviada en la web, pero el email tuvo un problema:\n\n${result.emailWarning}`)
      return
    }
    alert(sendToUser ? '✅ Cotización enviada al usuario.' : '✅ Cambios guardados.')
  }

  const handleSendCounterOffer = async () => {
    if (isManualQuote) {
      await persistManualQuote(true)
      return
    }

    setLoadingAction(true)
    try {
      await Promise.all(items.map((item) => supabase
        .from('buylist_items')
        .update({
          offered_price_unit: Number(item.offered_price_unit || 0),
          condition: item.condition || 'NM',
          is_foil: Boolean(item.is_foil || false),
        })
        .eq('id', item.id)
      ))

      const newTotal = items.reduce((sum, item) => sum + (Number(item.offered_price_unit || 0) * Number(item.quantity || 0)), 0)
      const { error: hdrErr } = await supabase
        .from('buylist_orders')
        .update({ total_offered: newTotal, status: 'waiting_user_approval' })
        .eq('id', id)

      if (hdrErr) throw hdrErr

      alert('✅ Contraoferta enviada. El usuario ha sido notificado.')
      router.refresh()
    } catch (error: any) {
      alert('Error enviando oferta: ' + error.message)
    } finally {
      setLoadingAction(false)
    }
  }

  const approve = async () => {
    if (!order || isManualQuote) return
    if (!window.confirm('¿Aprobar y acreditar créditos al usuario?')) return
    const { error } = await supabase.rpc('approve_buylist_transaction', { buylist_id_input: id, amount_to_credit: total })
    if (error) {
      alert('Error al aprobar: ' + error.message)
    } else {
      alert('✅ Transacción aprobada y créditos acreditados.')
      setOrder({ ...order, status: 'completed' })
      router.refresh()
    }
  }

  const reject = async () => {
    if (!order || isManualQuote) return
    if (!window.confirm('¿Rechazar esta solicitud?')) return
    const { error } = await supabase.from('buylist_orders').update({ status: 'rejected' }).eq('id', id)
    if (error) {
      alert('Error al rechazar: ' + error.message)
    } else {
      alert('Solicitud rechazada.')
      setOrder({ ...order, status: 'rejected' })
      router.refresh()
    }
  }

  if (loading) return <div className="p-8 text-center text-slate-500">Cargando detalles...</div>
  if (!order) return <div className="p-8 text-center text-red-500">{loadError || 'Orden no encontrada'}</div>

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      {zoomedImage && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4 animate-in fade-in duration-200" onClick={() => setZoomedImage(null)}>
          <button className="absolute right-4 top-4 cursor-pointer p-2 text-white/70 hover:text-white"><X size={32} /></button>
          <img src={zoomedImage} alt="Zoom" className="max-h-[90vh] max-w-full rounded-lg object-contain shadow-2xl" />
        </div>
      )}

      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="mb-4 flex flex-wrap items-center gap-2 text-xl font-bold text-slate-800 md:text-2xl">
            {isManualQuote ? 'Cotización manual' : 'Solicitud'}
            <span className="font-mono text-slate-500">#{String(order.id || '').slice(0, 8)}</span>
          </h1>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-20 text-slate-500">Usuario:</span>
              <span className="font-bold text-slate-900">
                {[order.profile?.first_name, order.profile?.last_name].filter(Boolean).join(' ') || 'Sin nombre registrado'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-20 text-slate-500">Email:</span>
              <span className="text-slate-700">{order.profile?.email || order.user_id}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-20 text-slate-500">Teléfono:</span>
              <span className="text-slate-700">{order.profile?.phone || 'No especificado'}</span>
            </div>
            <div className="mt-2 flex items-center gap-2 border-t border-slate-100 pt-2">
              <span className="w-20 text-slate-500">Fecha:</span>
              <span className="text-slate-700">{new Date(order.created_at).toLocaleString()}</span>
            </div>
          </div>
        </div>
        <div className="self-end md:self-start">
          <span className={`rounded-full border px-4 py-2 text-sm font-bold ${
            manualStatus === 'completed' ? 'border-emerald-200 bg-emerald-100 text-emerald-800' :
            manualStatus === 'rejected' || manualStatus === 'cancelled' ? 'border-red-200 bg-red-100 text-red-800' :
            manualStatus === 'draft' ? 'border-slate-200 bg-slate-100 text-slate-700' :
            'border-amber-200 bg-amber-100 text-amber-800'
          }`}>
            {getStatusLabel(manualStatus)}
          </span>
        </div>
      </div>

      {isManualEditable && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3">
            <h2 className="text-sm font-bold text-slate-900">Agregar cartas al borrador</h2>
            <p className="text-xs text-slate-500">Busca en el catálogo y suma las versiones que quieras cotizar.</p>
          </div>
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Buscar carta por nombre, set o número..."
              className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-[#9D1B1B] focus:ring-2 focus:ring-[#9D1B1B]/10"
            />
          </div>

          {searchQuery.trim().length >= 3 && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50">
              {searching ? (
                <div className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-slate-500">
                  <Loader2 size={16} className="animate-spin" /> Buscando cartas...
                </div>
              ) : searchResults.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-slate-500">No encontramos resultados con ese criterio.</div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {searchResults.map((result) => (
                    <button
                      key={`${result.id}-${result.finish || 'default'}`}
                      type="button"
                      onClick={() => addCardToManualQuote(result)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white cursor-pointer"
                    >
                      <div className="h-14 w-10 overflow-hidden rounded border border-slate-200 bg-slate-200">
                        {result.image_url ? <img src={result.image_url} alt={result.name} className="h-full w-full object-cover" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold text-slate-800">{result.name}</div>
                        <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-slate-500">
                          <span>{result.set_name}</span>
                          {result.collector_number && <span className="rounded bg-slate-100 px-1 font-mono text-slate-400">#{result.collector_number}</span>}
                          {result.finish && <span className="rounded border border-purple-200 bg-purple-50 px-1 text-purple-700">{result.finish}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs font-bold text-[#9D1B1B]">
                        <Plus size={16} /> Agregar
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="w-full overflow-x-auto">
          <table className="min-w-[860px] w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50 text-xs font-bold uppercase text-slate-600">
              <tr>
                <th className="px-4 py-3">Img</th>
                <th className="px-4 py-3">Carta</th>
                <th className="px-4 py-3">Mercado</th>
                <th className="px-4 py-3">Foil</th>
                <th className="px-4 py-3">Condición</th>
                <th className="px-4 py-3 text-center">Cant.</th>
                <th className="px-4 py-3 text-right">Oferta</th>
                <th className="px-4 py-3 text-center">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item: any, idx: number) => (
                <tr key={`${item.product_id || item.id}-${idx}`} className="transition-colors hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => getItemImage(item) && setZoomedImage(getItemImage(item))}
                      className="group/img relative h-14 w-10 cursor-zoom-in overflow-hidden rounded border border-slate-200 bg-slate-200"
                    >
                      {getItemImage(item) ? (
                        <>
                          <img src={getItemImage(item) || ''} alt={item.card_name || item.name || 'Carta'} className="h-full w-full object-cover" />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover/img:opacity-100">
                            <ZoomIn className="text-white drop-shadow-md" size={16} />
                          </div>
                        </>
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[8px] text-slate-400">Sin img</div>
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm font-bold text-slate-800" title={item.card_name || item.name}>
                      {item.card_name || item.name || item.notes || 'Carta desconocida'}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                      <span>{item.set_name}</span>
                      {item.collector_number ? <span>#{item.collector_number}</span> : null}
                      {getProduct(item)?.language ? <span className="rounded border border-blue-100 bg-blue-50 px-1 text-blue-700 uppercase">{String(getProduct(item)?.language).slice(0, 3)}</span> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs font-bold text-slate-700">US$ {Number(getItemMarketUnitPrice(item) || 0).toFixed(2)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <label className="inline-flex cursor-pointer select-none items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(item.is_foil)}
                        onChange={() => updateItem(idx, { is_foil: !Boolean(item.is_foil) })}
                        className="rounded text-purple-600 focus:ring-purple-500"
                      />
                      <span className={item.is_foil ? 'font-bold text-purple-700' : 'text-slate-500'}>{item.is_foil ? 'Sí' : 'No'}</span>
                    </label>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={item.condition || 'NM'}
                      onChange={(event) => updateItem(idx, { condition: event.target.value })}
                      className="cursor-pointer rounded border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-slate-900"
                    >
                      <option value="NM">NM</option>
                      <option value="EX">EX</option>
                      <option value="VG">VG</option>
                      <option value="G">G</option>
                      <option value="HP">HP</option>
                      <option value="DMG">DMG</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={Math.max(1, Number(item.quantity || 1))}
                      onChange={(event) => updateItem(idx, { quantity: Math.max(1, Number(event.target.value || 1)) })}
                      className="w-16 rounded border border-slate-300 px-2 py-1 text-center text-xs font-bold outline-none focus:ring-1 focus:ring-slate-900"
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <input
                      type="number"
                      step="0.01"
                      value={Number(item.offered_price_unit || 0)}
                      onChange={(event) => updateItem(idx, { offered_price_unit: Number(event.target.value || 0) })}
                      className="w-24 rounded border border-slate-300 px-2 py-1 text-right text-xs font-mono font-bold text-emerald-700 outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => deleteItem(item.id, idx)}
                      className="cursor-pointer rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                      title="Eliminar ítem"
                    >
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isManualQuote && (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Si el usuario acepta la cotización y se valida la recepción, el monto se acredita como créditos de tienda para usar enseguida en la web.
        </div>
      )}

      <div className="flex flex-col gap-4 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-lg text-slate-700">
          Total a Pagar: <span className="ml-2 text-2xl font-extrabold text-slate-900">US$ {Number(total || 0).toFixed(2)}</span>
        </div>
        <div className="flex w-full flex-wrap justify-center gap-2 sm:w-auto">
          {isManualEditable && (
            <>
              <button
                onClick={() => persistManualQuote(false)}
                disabled={loadingAction}
                className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
              >
                {loadingAction ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {order.sent_at ? 'Guardar cambios' : 'Guardar borrador'}
              </button>
              <button
                onClick={handleSendCounterOffer}
                disabled={loadingAction}
                className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#0F172A] px-4 py-2 text-sm font-bold text-white shadow-md hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
              >
                {loadingAction ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                {order.sent_at ? 'Reenviar al usuario' : 'Enviar al usuario'}
              </button>
            </>
          )}

          {isManualQuote && order.sent_at && (
            <a
              href={`/api/buylists/${id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-4 py-2 text-sm font-bold text-purple-700 hover:bg-purple-100"
            >
              <FileText size={16} /> Ver PDF
            </a>
          )}

          {!isManualQuote && order.status !== 'completed' && order.status !== 'rejected' && (
            <>
              <button onClick={handleSendCounterOffer} disabled={loadingAction} className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 sm:flex-none">
                {loadingAction ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Enviar Contraoferta
              </button>
              <button onClick={reject} className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-100 sm:flex-none">
                Rechazar
              </button>
              <button onClick={approve} className="w-full cursor-pointer rounded-lg bg-[#0F172A] px-6 py-2 text-sm font-bold text-white shadow-md hover:bg-slate-900 sm:w-auto">
                ✅ Aprobar y Pagar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
