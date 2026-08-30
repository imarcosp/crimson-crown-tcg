import Link from 'next/link'
import { ArrowRight, DatabaseZap, Search } from 'lucide-react'
import { notFound } from 'next/navigation'

import { getDeckBuilderDecks } from '@/lib/deck-builder/server'

export const dynamic = 'force-dynamic'

export default async function DeckBuilderFormatPage({
  params,
  searchParams,
}: {
  params: Promise<{ format: string }>
  searchParams: Promise<{ q?: string }>
}) {
  const [{ format: formatValue }, query] = await Promise.all([params, searchParams])
  const result = await getDeckBuilderDecks(formatValue, query.q)
  if (!result) notFound()

  return (
    <main className="min-h-[75vh] bg-slate-50">
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-9">
          <Link href="/deck-builder/magic" className="text-sm font-bold text-slate-500 hover:text-[#9D1B1B]">← Formatos Magic</Link>
          <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#9D1B1B]">Deckbuilder Magic</p>
              <h1 className="mt-1 text-3xl font-black text-slate-950 sm:text-4xl">{result.format.label}</h1>
              <p className="mt-2 text-sm text-slate-600">{result.decks.length} listas disponibles en el snapshot activo.</p>
            </div>
            <form className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
              <input name="q" defaultValue={query.q || ''} maxLength={80} placeholder="Buscar deck o arquetipo" className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-[#9D1B1B] focus:ring-2 focus:ring-[#9D1B1B]/10" />
            </form>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10">
        {result.decks.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <DatabaseZap className="mx-auto text-slate-400" size={38} />
            <h2 className="mt-4 text-xl font-black text-slate-900">{result.snapshots.length === 0 ? 'Estamos preparando este formato' : 'No encontramos coincidencias'}</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-600">{result.snapshots.length === 0 ? 'Todavía no existe un snapshot activo. La página queda disponible sin afectar el catálogo ni mostrar datos incompletos.' : 'Prueba con otro nombre, comandante o arquetipo.'}</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {result.decks.map((deck) => (
              <Link key={deck.id} href={`/deck-builder/magic/${result.format.slug}/${deck.id}`} className="group flex min-h-52 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#9D1B1B]/40 hover:shadow-lg">
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600">{deck.archetype || result.format.label}</span>
                  {Number(deck.stats?.metaShare || 0) > 0 && <span className="text-xs font-bold text-[#9D1B1B]">{Math.round(Number(deck.stats.metaShare) * 1000) / 10}% meta</span>}
                </div>
                <h2 className="mt-5 text-xl font-black leading-tight text-slate-900">{deck.name}</h2>
                {Array.isArray(deck.commander_names) && deck.commander_names.length > 0 && <p className="mt-2 text-sm text-slate-600">Comandante: {deck.commander_names.join(' + ')}</p>}
                {Number(deck.stats?.deckCount || 0) > 0 && <p className="mt-2 text-sm text-slate-500">Basado en {Number(deck.stats.deckCount).toLocaleString('es-AR')} decks.</p>}
                <span className="mt-auto flex items-center justify-end gap-2 pt-6 text-sm font-bold text-[#9D1B1B]">Ver lista <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" /></span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
