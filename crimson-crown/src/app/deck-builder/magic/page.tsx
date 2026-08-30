import Link from 'next/link'
import { ArrowRight, Clock3, Layers3, Sparkles } from 'lucide-react'

import { DECK_BUILDER_FORMATS } from '@/lib/deck-builder/core'
import { getDeckBuilderFormatOverview } from '@/lib/deck-builder/server'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Deckbuilder Magic | Crimson Crown' }

const FORMAT_DESCRIPTIONS: Record<string, string> = {
  commander: 'Comandantes populares y un shell de cartas recomendadas.',
  standard: 'Estrategias competitivas del entorno Standard actual.',
  pioneer: 'Arquetipos sin rotación desde Return to Ravnica.',
  modern: 'Decks competitivos desde Octava Edición en adelante.',
  legacy: 'Estrategias de alta potencia del formato eterno.',
  vintage: 'El formato construido con el pool más amplio.',
  pauper: 'Decks construidos exclusivamente con cartas comunes.',
  premodern: 'Magic clásico entre Cuarta Edición y Scourge.',
  'duel-commander': 'Commander competitivo uno contra uno.',
}

export default async function MagicDeckBuilderPage() {
  const snapshots = await getDeckBuilderFormatOverview()
  const overview = new Map<string, { deckCount: number; fetchedAt: string | null; sources: Set<string> }>()
  for (const snapshot of snapshots) {
    const current = overview.get(snapshot.format) || { deckCount: 0, fetchedAt: null, sources: new Set<string>() }
    current.deckCount += snapshot.deckCount
    current.sources.add(snapshot.source)
    if (!current.fetchedAt || snapshot.fetched_at > current.fetchedAt) current.fetchedAt = snapshot.fetched_at
    overview.set(snapshot.format, current)
  }

  return (
    <main className="min-h-[75vh] bg-slate-50">
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
          <Link href="/deck-builder" className="text-sm font-bold text-slate-500 hover:text-[#9D1B1B]">← Deckbuilder</Link>
          <div className="mt-6 flex items-start gap-4">
            <div className="rounded-2xl bg-purple-100 p-3 text-purple-700"><Sparkles size={30} /></div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#9D1B1B]">Magic: The Gathering</p>
              <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">Elige un formato</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">Explora listas consolidadas y compáralas con el stock disponible en Crimson Crown.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-10 sm:grid-cols-2 lg:grid-cols-3">
        {DECK_BUILDER_FORMATS.map((format) => {
          const data = overview.get(format.slug)
          return (
            <Link key={format.slug} href={`/deck-builder/magic/${format.slug}`} className="group flex min-h-52 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#9D1B1B]/40 hover:shadow-lg">
              <div className="flex items-start justify-between gap-3">
                <div className="rounded-xl bg-slate-100 p-2.5 text-slate-700"><Layers3 size={21} /></div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${data ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {data ? `${data.deckCount} decks` : 'Próximamente'}
                </span>
              </div>
              <h2 className="mt-5 text-xl font-black text-slate-900">{format.label}</h2>
              <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">{FORMAT_DESCRIPTIONS[format.slug]}</p>
              <div className="mt-5 flex items-center justify-between text-xs text-slate-500">
                <span className="inline-flex items-center gap-1"><Clock3 size={13} />{data?.fetchedAt ? new Date(data.fetchedAt).toLocaleDateString('es-AR') : 'Sin snapshot activo'}</span>
                <ArrowRight size={17} className="text-[#9D1B1B] transition-transform group-hover:translate-x-1" />
              </div>
            </Link>
          )
        })}
      </section>
    </main>
  )
}
