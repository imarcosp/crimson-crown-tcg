import Link from 'next/link'
import { ArrowRight, Layers3, Sparkles } from 'lucide-react'

export const metadata = { title: 'Deckbuilder | Crimson Crown' }

export default function DeckBuilderPage() {
  return (
    <main className="min-h-[70vh] bg-slate-50">
      <section className="border-b border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-[#4a0e16] text-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
          <div className="max-w-3xl">
            <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-red-100">
              <Layers3 size={14} /> Explora. Comprueba. Completa.
            </span>
            <h1 className="text-4xl font-black tracking-tight sm:text-6xl">Deckbuilder Crimson</h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
              Descubre listas representativas del metajuego y revisa de inmediato qué cartas están disponibles en nuestros inventarios.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
        <Link href="/deck-builder/magic" className="group block overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-[#9D1B1B]/40 hover:shadow-xl sm:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-purple-100 p-3 text-purple-700"><Sparkles size={28} /></div>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#9D1B1B]">Disponible ahora</p>
                <h2 className="mt-1 text-2xl font-black text-slate-900">Magic: The Gathering</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Commander y formatos construidos, cobertura del inventario local y cotización de faltantes.</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-2 font-bold text-[#9D1B1B]">Abrir formatos <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" /></span>
          </div>
        </Link>
      </section>
    </main>
  )
}
