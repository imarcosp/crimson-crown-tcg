"use client"
import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Papa from 'papaparse'
import { Upload, Loader2, FileSpreadsheet, CheckCircle } from 'lucide-react'
import { importAdminProducts } from '@/app/actions/admin-products'
import { MIN_PRODUCT_PRICE_USD } from '@/lib/pricing/constants'
import {
  canonicalizeMagicFinishLabel,
  getReferencePriceForFinish,
  resolveMagicFinishSelection,
} from '@/lib/cards/finish-normalization'

export default function CsvUploader({ inventoryId }: { inventoryId: string }) {
  const supabase = createClient()
  const [step, setStep] = useState<'upload' | 'preview' | 'processing' | 'done'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [parsedRows, setParsedRows] = useState<any[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [progress, setProgress] = useState(0)
  const [stats, setStats] = useState({ total: 0, inserted: 0, updated: 0, errors: 0 })
  const importRunIdRef = useRef<string | null>(null)

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
    importRunIdRef.current = crypto.randomUUID()
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
    setProgress(0)
    const runId = importRunIdRef.current || crypto.randomUUID()
    importRunIdRef.current = runId
    const preparationErrors: Array<{ index: number; error: string }> = []
    const preparedRows: Array<{ originalIndex: number; operationKey: string; product: unknown }> = []
    const PREPARATION_BATCH_SIZE = 5

    for (let start = 0; start < parsedRows.length; start += PREPARATION_BATCH_SIZE) {
      const batch = parsedRows.slice(start, start + PREPARATION_BATCH_SIZE)
      const preparedBatch = await Promise.all(batch.map(async (row, offset) => {
        const index = start + offset
        const rawName = getCol(row, 'Name', 'name')
        try {
          const normalize = (value: unknown) => String(value || '').trim().replace(/\s+/g, ' ')
          const name = normalize(rawName)
          const setName = normalize(getCol(row, 'Set name', 'set_name') || getCol(row, 'Set code', 'code'))
          let finish = 'Non-Foil'
          const foilValue = String(getCol(row, 'Foil') || '').toLowerCase()
          const etchedValue = String(getCol(row, 'Etched') || '').toLowerCase()
          if (foilValue.includes('foil') || foilValue === 'true' || foilValue === 'yes') finish = 'Foil'
          if (etchedValue === 'true' || name.toLowerCase().includes('etched')) finish = 'Etched Foil'

          const condition = mapCondition(getCol(row, 'Condition') || '')
          const language = mapLanguage(getCol(row, 'Language') || '')
          const scryfallId = normalize(getCol(row, 'Scryfall ID', 'scryfall_id', 'scryfall id')) || null
          const externalContext = await fetchExternalFinishContext(scryfallId)
          finish = resolveMagicFinishSelection(canonicalizeMagicFinishLabel(finish), null, externalContext)
          const quantityValue = getCol(row, 'Quantity', 'quantity')
          const stock = quantityValue === null || String(quantityValue).trim() === '' ? 1 : Number(quantityValue)
          const collectorNumber = normalize(getCol(row, 'Collector number', 'number')) || null
          const imageUrl = Number.isInteger(stock) && stock >= 0
            ? await fetchScryfallImage(scryfallId, name, setName)
            : ''
          const price = await getInitialPriceFromExternal(externalContext, finish, condition)
          const rawRarity = normalize(getCol(row, 'Rarity'))

          return {
            originalIndex: index,
            operationKey: `csv:${runId}:${index}`,
            product: {
              name,
              set_name: setName,
              collector_number: collectorNumber,
              scryfall_id: scryfallId,
              tcg: 'Magic',
              stock,
              price_usd: price,
              is_manual_price: false,
              condition,
              language,
              finish,
              image_url: imageUrl,
              rarity: rawRarity ? rawRarity.charAt(0).toUpperCase() + rawRarity.slice(1) : '',
              metadata: {},
            },
          }
        } catch {
          preparationErrors.push({ index, error: 'No se pudo preparar esta fila.' })
          return null
        }
      }))
      preparedRows.push(...preparedBatch.filter((row): row is NonNullable<typeof row> => row !== null))
      const preparedCount = Math.min(start + batch.length, parsedRows.length)
      setProgress(parsedRows.length > 0 ? Math.round((preparedCount / parsedRows.length) * 70) : 70)
    }

    const result = await importAdminProducts({
      inventoryId,
      rows: preparedRows.map(({ operationKey, product }) => ({ operationKey, product })),
    })

    if (result.success) {
      const actionErrors = result.data.errors.map((error) => ({
        index: preparedRows[error.index]?.originalIndex ?? error.index,
        error: error.error,
      }))
      const allErrors = [...preparationErrors, ...actionErrors].sort((left, right) => left.index - right.index)
      setLogs(allErrors.map(({ index, error }) => {
        const name = getCol(parsedRows[index] || {}, 'Name', 'name') || `fila ${index + 1}`
        return `❌ Error en ${name}: ${error}`
      }))
      setStats({
        total: parsedRows.length,
        inserted: result.data.inserted,
        updated: result.data.updated,
        errors: allErrors.length,
      })
    } else {
      setLogs([`❌ ${result.error}`])
      setStats({ total: parsedRows.length, inserted: 0, updated: 0, errors: parsedRows.length })
    }
    setProgress(100)
    setStep('done')
  }

  const reset = () => {
    setStep('upload')
    setFile(null)
    setParsedRows([])
    setProgress(0)
    setLogs([])
    importRunIdRef.current = null
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
