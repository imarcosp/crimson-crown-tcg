"use client"
import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useStore } from '@/store/useStore'
import ProductCard from "@/components/catalog/ProductCard"
import SortDropdown from "@/components/catalog/SortDropdown"
import { Lightbulb, SearchX } from 'lucide-react'

function SearchContent() {
  const searchParams = useSearchParams()
  const q = searchParams.get('q') || ''

  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const qStore = useStore((s) => s.searchQuery)
  const setRate = useStore((s) => s.setRate)

  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [suggestion, setSuggestion] = useState('')

  useEffect(() => {
    fetch('/api/dolar')
      .then(res => res.json())
      .then(data => {
        const val = data.blue || data.venta || data.value || data.oficial
        if (val) setRate(Number(val))
      })
      .catch(e => console.error("Error dolar:", e))
  }, [])

  useEffect(() => { if (q && q !== qStore) setSearchQuery(q) }, [q, qStore, setSearchQuery])
  
  useEffect(() => {
    if (!q) return; 
    setLoading(true); 
    setSuggestion('');
    
    fetch(`/api/search?q=${encodeURIComponent(q)}`) 
      .then(r => r.json()) 
      .then(data => {
        setResults(data || [])
        if (data && data.length > 0 && data[0].didYouMean) {
            setSuggestion(data[0].didYouMean)
        }
      }) 
      .finally(() => setLoading(false))
  }, [q])

  return (
    <div className="space-y-8 pb-12">
      <div className="bg-[#0F172A] pt-24 pb-12 text-white">
        <div className="container mx-auto px-4">
            <h1 className="text-3xl font-bold">Resultados para: "{q}"</h1>
        </div>
      </div>

      <div className="container mx-auto px-4">
        {suggestion && (
            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3 text-amber-800 animate-in fade-in slide-in-from-top-2">
                <Lightbulb className="shrink-0 mt-0.5 text-amber-600" size={20}/>
                <div>
                    <p className="font-bold">No encontramos resultados exactos para "{q}".</p>
                    <p>
                        Quizá quisiste decir <span className="font-extrabold underline text-amber-900">"{suggestion}"</span>. 
                        Te estamos mostrando esos resultados.
                    </p>
                </div>
            </div>
        )}

        <div>
            <div className="flex items-center justify-between mb-6">
              <span className="text-sm text-slate-500 font-bold">{results.length} resultados encontrados</span>
              <SortDropdown />
            </div>

            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 animate-pulse">
                {[...Array(10)].map((_, i) => (
                  <div key={i} className="aspect-[3/4] bg-slate-200 rounded-xl" />
                ))}
              </div>
            ) : (
              results.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {results.map((r: any, idx: number) => {
                    const finish = (r.finish || r.finishes?.[0] || '').toLowerCase()
                    const isFoil = (finish.includes('foil') && !finish.includes('non')) || finish.includes('etched') || finish.includes('holo')
                    
                    // Verificamos stock total (normal + foil)
                    const hasStock = r.stock > 0 || r.stock_foil > 0 || r.stockFoil > 0

                    return (
                      <div key={`${r.id}-${idx}`} className="h-full">
                        <ProductCard 
                          id={r.id}
                          name={r.name}
                          tcg={r.tcg || 'Magic'}
                          priceUsd={Number(r.price_usd || r.priceUsd || 0)}
                          priceUsdFoil={Number(r.price_usd_foil || r.priceUsdFoil || 0)}
                          stock={r.stock || 0}
                          condition={r.condition || 'NM'}
                          isFoil={isFoil}
                          rarity={r.rarity || ''}
                          image={r.image_url || r.image}
                          setName={r.set_name}
                          collectorNumber={r.collector_number}
                          // Si tiene stock (sea cual sea), mostramos Stock, si no, Backorder (Importar)
                          availability={hasStock ? 'stock' : 'backorder'}
                          language={r.language}
                          isImport={!hasStock}
                        />
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="py-20 text-center border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center">
                  <SearchX className="text-slate-300 mb-4" size={48} />
                  <p className="text-slate-500 font-medium">No encontramos cartas con ese nombre.</p>
                  <p className="text-sm text-slate-400 mt-2">Intenta con el nombre en inglés o palabras clave.</p>
                </div>
              )
            )}
        </div>
      </div>
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center">Cargando resultados...</div>}>
      <SearchContent />
    </Suspense>
  )
}