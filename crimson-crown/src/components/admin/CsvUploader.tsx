"use client"
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import Papa from 'papaparse'
import { Upload, Loader2, FileSpreadsheet, CheckCircle } from 'lucide-react'
import { processWishlistNotifications } from '@/app/actions/wishlist' // <--- IMPORTAR
import { MIN_PRODUCT_PRICE_USD } from '@/lib/pricing/constants'
import {
  canonicalizeMagicFinishLabel,
  getReferencePriceForFinish,
  resolveMagicFinishSelection,
} from '@/lib/cards/finish-normalization'

export default function CsvUploader() {
  const [step, setStep] = useState<'upload' | 'preview' | 'processing' | 'done'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [parsedRows, setParsedRows] = useState<any[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [progress, setProgress] = useState(0)
  const [stats, setStats] = useState({ total: 0, inserted: 0, updated: 0, errors: 0 })

  const mapCondition = (cond: string) => {
    const c = String(cond).toLowerCase()
    if (c.includes('near') || c.includes('nm')) return 'NM'
    if (c.includes('excellent') || c.includes('lightly')) return 'PL'
    if (c.includes('good') || c.includes('moderately')) return 'HP'
    if (c.includes('played') || c.includes('poor')) return 'HP'
    return 'NM'
  }

  const mapLanguage = (lang: string) => {
    const l = String(lang).toLowerCase()
    const map: Record<string, string> = {
      en: 'English', english: 'English',
      es: 'Spanish', spanish: 'Spanish',
      jp: 'Japanese', japanese: 'Japanese',
      pt: 'Portuguese', portuguese: 'Portuguese',
      it: 'Italian', italian: 'Italian',
      fr: 'French', french: 'French',
      de: 'German', german: 'German',
      ru: 'Russian', russian: 'Russian',
      zh: 'Chinese', chinese: 'Chinese',
    }
    return map[l] || (lang ? lang.charAt(0).toUpperCase() + lang.slice(1) : 'English')
  }

  // Helper para buscar imágenes
  const fetchScryfallImage = async (scryfallId: string | null, name: string, setCode: string) => {
    try {
      let url = ''
      if (scryfallId) {
        url = `https://api.scryfall.com/cards/${scryfallId}`
      } else if (setCode && name) {
        url = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}&set=${setCode}`
      } else {
        url = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`
      }
      const res = await fetch(url)
      if (!res.ok) return ''
      const data = await res.json()
      if (data.image_uris?.normal) return data.image_uris.normal
      if (data.card_faces?.[0]?.image_uris?.normal) return data.card_faces[0].image_uris.normal
      return ''
    } catch {
      return ''
    }
  }

  const getCol = (row: any, ...candidates: string[]) => {
    const keys = Object.keys(row)
    for (const cand of candidates) {
        const found = keys.find(k => k.toLowerCase().trim() === cand.toLowerCase().trim())
        if (found) return row[found]
    }
    return null
  }

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  const fetchExternalFinishContext = async (scryfallId: string | null) => {
    if (!scryfallId) return null
    const { data, error } = await supabase
      .from('external_prices')
      .select('foil_variant, active_price_normal, active_price_foil, cardkingdom_retail_normal, cardkingdom_retail_foil, cardkingdom_retail_etched, tcgplayer_market_normal, tcgplayer_market_foil')
      .eq('scryfall_id', scryfallId)
      .maybeSingle()

    if (error) return null
    return data
  }

  const getInitialPriceFromExternal = async (
    externalContext: any,
    finish: string,
    condition: string
  ) => {
    const fallbackPrice = MIN_PRODUCT_PRICE_USD
    if (!externalContext) return fallbackPrice

    const basePrice = getReferencePriceForFinish(externalContext, finish)
    if (basePrice <= 0) return fallbackPrice

    const normalizedCondition = String(condition || 'NM').toUpperCase()
    let multiplier = 1
    if (normalizedCondition === 'PL' || normalizedCondition === 'SP') multiplier = 0.85
    if (normalizedCondition === 'HP' || normalizedCondition === 'MP') multiplier = 0.75
    if (normalizedCondition === 'DMG') multiplier = 0.5

    let finalPrice = basePrice * multiplier
    if (finalPrice < MIN_PRODUCT_PRICE_USD) finalPrice = MIN_PRODUCT_PRICE_USD

    return Math.round(finalPrice * 100) / 100
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return
    setFile(selectedFile)
    Papa.parse(selectedFile, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as any[]
        const hasName = rows.length > 0 && Object.keys(rows[0]).some(k => k.toLowerCase() === 'name')
        if (rows.length > 0 && !hasName) {
          alert("El archivo no parece tener la columna 'Name'. Verifica que sea de ManaBox.")
          setFile(null)
          return
        }
        setParsedRows(rows)
        setStep('preview')
      },
    })
  }

  const handleImport = async () => {
    setStep('processing')
    setLogs([])
    setStats({ total: parsedRows.length, inserted: 0, updated: 0, errors: 0 })
    let inserted = 0
    let updated = 0
    let errs = 0
    const BATCH_SIZE = 5
    
    // LISTA DE PRODUCTOS QUE ENTRARON CON STOCK (Para notificar)
    const stockArrivals: { id: string, name: string }[] = []

    for (let i = 0; i < parsedRows.length; i += BATCH_SIZE) {
      const batch = parsedRows.slice(i, i + BATCH_SIZE)
      await Promise.all(
        batch.map(async (row) => {
          const name = getCol(row, 'Name', 'name')
          if (!name) return
          try {
            let finish = 'Non-Foil'
            const foilVal = String(getCol(row, 'Foil') || '').toLowerCase()
            const etchedVal = String(getCol(row, 'Etched') || '').toLowerCase()
            if (foilVal.includes('foil') || foilVal === 'true' || foilVal === 'yes') finish = 'Foil'
            if (etchedVal === 'true' || name.toLowerCase().includes('etched')) finish = 'Etched Foil'
            
            const condition = mapCondition(getCol(row, 'Condition') || '')
            const language = mapLanguage(getCol(row, 'Language') || '')
            const scryfallId = getCol(row, 'Scryfall ID', 'scryfall_id', 'scryfall id') || null
            const externalContext = await fetchExternalFinishContext(scryfallId)
            finish = resolveMagicFinishSelection(canonicalizeMagicFinishLabel(finish), null, externalContext)
            const stockToAdd = Number(getCol(row, 'Quantity', 'quantity') || 1)
            const setName = getCol(row, 'Set name', 'set_name') || getCol(row, 'Set code', 'code')
            const collectorNumber = String(getCol(row, 'Collector number', 'number') || '').trim()
            const normalize = (s: any) => String(s || '').trim().replace(/\s+/g, ' ')
            const normName = normalize(name)
            const normSet = normalize(setName)

            let query = supabase
              .from('products')
              .select('id, stock, image_url')
              .eq('finish', finish)
              .eq('condition', condition)
              .eq('language', language)

            if (scryfallId) {
              query = query.eq('scryfall_id', scryfallId)
            } else {
              query = query.ilike('name', normName).ilike('set_name', normSet)
              if (collectorNumber) query = query.eq('collector_number', collectorNumber)
            }

            const { data: existingArr } = await query.order('created_at', { ascending: false }).limit(1)
            const existing = Array.isArray(existingArr) ? existingArr[0] : null

            if (existing) {
              const { error } = await supabase
                .from('products')
                .update({ stock: (existing.stock || 0) + stockToAdd })
                .eq('id', existing.id)
              if (error) throw error
              updated++
              // SI HAY STOCK POSITIVO QUE SE AGREGA, GUARDAR PARA NOTIFICAR
              if (stockToAdd > 0) {
                  stockArrivals.push({ id: existing.id, name: name })
              }
            } else {
              await delay(100)
              const fetchedImage = await fetchScryfallImage(scryfallId, name, setName)
              const initialPrice = await getInitialPriceFromExternal(externalContext, finish, condition)
              const rpcPayload = {
                p_name: normName,
                p_set_name: normSet,
                p_collector_number: collectorNumber || null,
                p_scryfall_id: scryfallId || null,
                p_tcg: 'Magic',
                p_finish: finish,
                p_condition: condition,
                p_language: language,
                p_price_usd: initialPrice,
                p_image_url: fetchedImage || null,
                p_metadata: null,
                p_stock: stockToAdd,
              }
              const { data: rpcRes, error: rpcErr } = await supabase.rpc('upsert_product_variant', rpcPayload)
              if (!rpcErr && rpcRes) {
                inserted++
                const newId = String(rpcRes)
                if (stockToAdd > 0) stockArrivals.push({ id: newId, name: normName })
              } else {
                const insertPayload = {
                  name: normName,
                  set_name: normSet,
                  collector_number: collectorNumber || getCol(row, 'Collector number', 'number'),
                  scryfall_id: scryfallId,
                  tcg: 'Magic',
                  stock: stockToAdd,
                  price_usd: initialPrice,
                  is_manual_price: false,
                  condition,
                  language,
                  finish,
                  image_url: fetchedImage,
                  rarity: getCol(row, 'Rarity') ? String(getCol(row, 'Rarity')).charAt(0).toUpperCase() + String(getCol(row, 'Rarity')).slice(1) : '',
                }
                const { data: newProd, error } = await supabase.from('products').insert(insertPayload).select('id').single()
                if (!error) {
                  inserted++
                  if (stockToAdd > 0 && newProd) stockArrivals.push({ id: newProd.id, name: normName })
                } else {
                  const msg = String(error.message || '')
                  if (msg.includes('unique') || msg.includes('duplicate key')) {
                    let conflictQ = supabase
                      .from('products')
                      .select('id, stock')
                      .eq('finish', finish)
                      .eq('condition', condition)
                      .eq('language', language)
                      .eq('tcg', 'Magic')
                    if (scryfallId) conflictQ = conflictQ.eq('scryfall_id', scryfallId)
                    else {
                      conflictQ = conflictQ.ilike('name', normName).ilike('set_name', normSet)
                      if (collectorNumber) conflictQ = conflictQ.eq('collector_number', collectorNumber)
                    }
                    const { data: existArr } = await conflictQ.order('created_at', { ascending: false }).limit(1)
                    const exist = Array.isArray(existArr) ? existArr[0] : null
                    if (exist) {
                      const newStock = Number(exist.stock || 0) + Number(stockToAdd || 0)
                      const { error: updErr } = await supabase
                        .from('products')
                        .update({ stock: newStock, image_url: fetchedImage })
                        .eq('id', exist.id)
                      if (!updErr) {
                        updated++
                        if (stockToAdd > 0) stockArrivals.push({ id: exist.id, name: normName })
                      } else {
                        throw updErr
                      }
                    } else {
                      throw error
                    }
                  } else {
                    throw error
                  }
                }
              }
            }
          } catch (err: any) {
            errs++
            setLogs((prev) => [...prev, `❌ Error en ${name}: ${err.message}`])
          }
        })
      )
      const currentProgress = Math.round(((i + batch.length) / parsedRows.length) * 100)
      setProgress(Math.min(currentProgress, 100))
      setStats({ total: parsedRows.length, inserted, updated, errors: errs })
    }

    // --- PROCESAR NOTIFICACIONES AL FINAL ---
    if (stockArrivals.length > 0) {
        console.log(`🔔 Procesando notificaciones para ${stockArrivals.length} productos importados...`)
        processWishlistNotifications(stockArrivals)
    }

    setStep('done')
  }

  const reset = () => {
    setStep('upload')
    setFile(null)
    setParsedRows([])
    setProgress(0)
    setLogs([])
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      {step === 'upload' && (
        <div className="p-10 border-2 border-dashed border-slate-300 rounded-xl bg-slate-50 flex flex-col items-center justify-center text-center hover:bg-slate-100 transition-colors">
          <div className="bg-purple-100 p-4 rounded-full mb-4">
            <FileSpreadsheet className="h-10 w-10 text-purple-600" />
          </div>
          <h3 className="text-xl font-bold text-slate-800 mb-2">Importar Inventario</h3>
          <p className="text-slate-500 mb-8 max-w-sm mx-auto">Sube tu CSV de <strong>ManaBox</strong>. Buscaremos imágenes automáticamente si faltan.</p>
          <label className="cursor-pointer bg-[#0F172A] hover:bg-slate-800 text-white px-8 py-3 rounded-lg font-bold flex items-center gap-2 shadow-lg transition-transform active:scale-95">
            <Upload size={20} />
            Seleccionar CSV
            <input type="file" accept=".csv" className="hidden" onChange={handleFileSelect} />
          </label>
        </div>
      )}

      {step === 'preview' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-6 animate-in fade-in zoom-in duration-200">
          <div className="flex items-center gap-4 mb-6">
            <div className="bg-blue-100 p-3 rounded-full text-blue-600"><FileSpreadsheet size={24} /></div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Archivo listo para importar</h3>
              <p className="text-sm text-slate-500">{file?.name}</p>
            </div>
          </div>
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 mb-6 flex justify-around text-center">
            <div>
              <div className="text-2xl font-bold text-slate-900">{parsedRows.length}</div>
              <div className="text-xs font-bold text-slate-500 uppercase">Filas Detectadas</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">ManaBox</div>
              <div className="text-xs font-bold text-slate-500 uppercase">Formato</div>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={reset} className="flex-1 py-3 rounded-lg border border-slate-300 text-slate-600 font-bold hover:bg-slate-50">Cancelar</button>
            <button onClick={handleImport} className="flex-1 py-3 rounded-lg bg-[#0F172A] text-white font-bold hover:bg-slate-800 shadow-md">Confirmar e Importar</button>
          </div>
        </div>
      )}

      {step === 'processing' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-8 text-center">
          <Loader2 className="animate-spin h-12 w-12 text-purple-600 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-slate-900 mb-2">Importando y buscando imágenes...</h3>
          <p className="text-slate-500 mb-6">Esto puede tardar un poco más para asegurar que todas tengan foto.</p>
          <div className="w-full bg-slate-200 rounded-full h-4 mb-2 overflow-hidden">
            <div className="bg-purple-600 h-4 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
          </div>
          <div className="flex justify-between text-xs text-slate-500 font-bold">
            <span>{stats.updated} actualizadas / {stats.inserted} nuevas</span>
            <span>{progress}%</span>
          </div>
          {logs.length > 0 && (
            <div className="mt-6 h-32 overflow-y-auto bg-slate-900 text-green-400 text-left p-3 rounded text-xs font-mono">
              {logs.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 'done' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-8 text-center animate-in fade-in">
          <div className="bg-green-100 p-4 rounded-full w-fit mx-auto mb-4">
            <CheckCircle className="h-10 w-10 text-green-600" />
          </div>
          <h3 className="text-2xl font-bold text-slate-900 mb-2">¡Importación Finalizada!</h3>
          <p className="text-slate-500 mb-8">
            Nuevas: <strong>{stats.inserted}</strong> | Actualizadas: <strong>{stats.updated}</strong>
            {stats.errors > 0 && <span className="text-red-500 block mt-2">Errores: {stats.errors}</span>}
          </p>
          <button onClick={() => window.location.reload()} className="px-8 py-3 rounded-lg bg-[#0F172A] text-white font-bold hover:bg-slate-800 shadow-lg">Volver al Inventario</button>
          <p className="text-xs text-slate-400 mt-4">Los precios se asignaron al importar cuando hubo referencia en `external_prices`.</p>
        </div>
      )}
    </div>
  )
}
