import Image from 'next/image'
import Link from 'next/link'
import { CheckCircle2, ExternalLink, PackageCheck, PackageX } from 'lucide-react'
import { notFound } from 'next/navigation'

import { DeckBuilderBulkActions, DeckBuilderCardActions } from '@/components/deck-builder/DeckBuilderActions'
import { groupDeckCards } from '@/lib/deck-builder/core'
import { getDeckBuilderDeck } from '@/lib/deck-builder/server'

export const dynamic = 'force-dynamic'

const GROUPS = [
  ['commanders', 'Comandante'],
  ['mainboard', 'Mazo principal'],
  ['sideboard', 'Sideboard'],
  ['companions', 'Companion'],
  ['maybeboard', 'Maybeboard'],
] as const

export default async function DeckBuilderDeckPage({ params }: { params: Promise<{ format: string; deckId: string }> }) {
  const { format, deckId } = await params
  const result = await getDeckBuilderDeck(format, deckId)
  if (!result) notFound()
  const grouped = groupDeckCards(result.cards)

  return (
    <main className="min-h-[75vh] bg-slate-50 pb-16">
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-9">
          <Link href={`/deck-builder/magic/${result.format.slug}`} className="text-sm font-bold text-slate-500 hover:text-[#9D1B1B]">← {result.format.label}</Link>
          <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#9D1B1B]">{result.deck.archetype || result.format.label}</p>
              <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">{result.deck.name}</h1>
              {Array.isArray(result.deck.commander_names) && result.deck.commander_names.length > 0 && <p className="mt-3 text-sm text-slate-600">Comandante: {result.deck.commander_names.join(' + ')}</p>}
              {result.deck.source_url && <a href={result.deck.source_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-[#9D1B1B]">Ver fuente pública <ExternalLink size={13} /></a>}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:min-w-[520px]">
              <Metric label="Cobertura" value={`${result.coverage.coveragePercent}%`} />
              <Metric label="Cartas únicas" value={`${result.coverage.coveredUniqueCards}/${result.coverage.requiredUniqueCards}`} />
              <Metric label="Copias locales" value={`${result.coverage.availableLocalQuantity}/${result.coverage.requiredQuantity}`} />
              <Metric label="Faltantes" value={String(result.coverage.missingLocalQuantity)} />
            </div>
          </div>
          <div className="mt-7 border-t border-slate-100 pt-6"><DeckBuilderBulkActions cards={result.cards} /></div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl space-y-8 px-4 py-10">
        {GROUPS.map(([key, label]) => {
          const cards = grouped[key]
          if (cards.length === 0) return null
          return (
            <section key={key}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-black text-slate-900">{label}</h2>
                <span className="text-xs font-bold text-slate-500">{cards.reduce((total, card) => total + Number(card.quantity || 0), 0)} cartas</span>
              </div>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {cards.map((card) => {
                  const localCopies = Math.min(card.quantity, card.availableLocalQuantity)
                  const imageCandidate = card.localProduct?.image_url || card.importSuggestion?.image_url || card.image_url
                  const imageUrl = typeof imageCandidate === 'string' ? imageCandidate : ''
                  return (
                    <article key={card.id} className="flex flex-col gap-4 border-b border-slate-100 p-4 last:border-b-0 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-md bg-slate-100">
                          {imageUrl ? <Image src={imageUrl} alt="" fill sizes="48px" className="object-cover" unoptimized /> : <div className="flex h-full items-center justify-center text-slate-400">?</div>}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2"><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-700">{card.quantity}x</span><h3 className="truncate font-bold text-slate-900">{card.name}</h3></div>
                          <div className="mt-2 flex flex-wrap gap-3 text-xs">
                            {localCopies > 0 ? <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><PackageCheck size={14} />{localCopies} local</span> : <span className="inline-flex items-center gap-1 font-semibold text-slate-500"><PackageX size={14} />Sin stock local</span>}
                            {localCopies >= card.quantity && <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><CheckCircle2 size={14} />Completa</span>}
                          </div>
                        </div>
                      </div>
                      <DeckBuilderCardActions card={card} />
                    </article>
                  )
                })}
              </div>
            </section>
          )
        })}
      </section>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-xl font-black text-slate-900">{value}</p></div>
}
