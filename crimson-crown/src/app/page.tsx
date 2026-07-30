import { createClient } from '@/lib/supabase/server'
import Hero from '@/components/layout/Hero'
import ProductCard from '@/components/catalog/ProductCard'
import Link from 'next/link'
import { ArrowRight, Sparkles, Package, Crown, Zap } from 'lucide-react'
import { siteConfig } from '@/config/site'

export const revalidate = 0

// Juegos de Cartas para excluir en la sección "Otros Productos"
const CARD_TCGS = ['Magic', 'Riftbound', 'Pokémon', 'Lorcana', 'Yu-Gi-Oh!', 'One Piece', 'Star Wars', 'Gundam']

export default async function Home() {
  const supabase = await createClient()

  // --- 1. MAGIC: ÚLTIMOS INGRESOS ---
  const { data: magicLatest } = await supabase
    .from('products')
    .select('*')
    .eq('tcg', 'Magic')
    .gt('stock', 0)
    .gt('price_usd', 5)
    .order('created_at', { ascending: false })
    .limit(10)

  // --- 2. RIFTBOUND: ÚLTIMOS INGRESOS ---
  const { data: riftLatest } = await supabase
    .from('products')
    .select('*')
    .eq('tcg', 'Riftbound')
    .gt('stock', 0)
    .gt('price_usd', 5)
    .order('created_at', { ascending: false })
    .limit(10)

  // --- 3. MAGIC: DESTACADOS (CAROS) ---
  const { data: magicFeatured } = await supabase
    .from('products')
    .select('*')
    .eq('tcg', 'Magic')
    .gt('stock', 0)
    .order('price_usd', { ascending: false })
    .limit(10)

  // --- 4. RIFTBOUND: DESTACADOS (CAROS) ---
  const { data: riftFeatured } = await supabase
    .from('products')
    .select('*')
    .eq('tcg', 'Riftbound')
    .gt('stock', 0)
    .order('price_usd', { ascending: false })
    .limit(10)

  // --- 5. OTROS PRODUCTOS (Accesorios) ---
  const { data: accessories } = await supabase
    .from('products')
    .select('*')
    .gt('stock', 0)
    .not('tcg', 'in', `(${CARD_TCGS.map(t => `"${t}"`).join(',')})`)
    .limit(10)

  // Helper para mapear producto
  const mapProduct = (p: any) => {
    const finish = String(p.finish || '').toLowerCase()
    const isFoil = (finish.includes('foil') && !finish.includes('non')) || finish.includes('etched') || finish.includes('holo')

    return {
      id: String(p.id),
      name: String(p.name || ''),
      tcg: String(p.tcg || 'Magic'),
      priceUsd: Number(p.price_usd || 0),
      stock: Number(p.stock || 0),
      condition: String(p.condition || 'NM'),
      isFoil,
      finish: p.finish,
      rarity: String(p.rarity || ''),
      image: p.image_url,
      setName: p.set_name,
      collectorNumber: p.collector_number,
      language: p.language,
      availability: 'stock' as const,
      isImport: false,
    }
  }

  return (
    <div className="space-y-16 pb-12">
      <Hero />
      
      <div className="container mx-auto px-4 space-y-16">
        
        {/* 1. MAGIC: ÚLTIMOS INGRESOS */}
        {magicLatest && magicLatest.length > 0 && (
            <section className="space-y-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                    <h2 className="text-2xl font-bold text-[#0F172A] flex items-center gap-2">
                        <Sparkles className="text-purple-500"/> Últimos Ingresos Magic
                    </h2>
                    <Link href="/catalog?tcg=Magic&sort=newest" className="text-sm font-bold text-slate-500 hover:text-[#9D1B1B] flex items-center gap-1 transition-colors group">
                        Ver novedades Magic <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform"/>
                    </Link>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {magicLatest.map((p: any) => <ProductCard key={`ml-${p.id}`} {...mapProduct(p)} />)}
                </div>
            </section>
        )}

        {/* 2. RIFTBOUND: ÚLTIMOS INGRESOS */}
        {siteConfig.features?.showRiftbound && riftLatest && riftLatest.length > 0 && (
            <section className="space-y-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                    <h2 className="text-2xl font-bold text-[#1C1B22] flex items-center gap-2">
                        <Zap className="text-yellow-500"/> Últimos Ingresos Riftbound
                    </h2>
                    <Link href="/catalog?tcg=Riftbound&sort=newest" className="text-sm font-bold text-slate-500 hover:text-[#9D1B1B] flex items-center gap-1 transition-colors group">
                        Ver novedades Riftbound <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform"/>
                    </Link>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {riftLatest.map((p: any) => <ProductCard key={`rl-${p.id}`} {...mapProduct(p)} />)}
                </div>
            </section>
        )}

        {/* 3. MAGIC: DESTACADOS */}
        {magicFeatured && magicFeatured.length > 0 && (
            <section className="space-y-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                    <h2 className="text-2xl font-bold text-[#1C1B22] flex items-center gap-2">
                        <Crown className="text-amber-500"/> Destacados Magic
                    </h2>
                    <Link href="/catalog?tcg=Magic&sort=price_desc" className="text-sm font-bold text-slate-500 hover:text-[#9D1B1B] flex items-center gap-1 transition-colors group">
                        Ver cartas caras <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform"/>
                    </Link>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {magicFeatured.map((p: any) => <ProductCard key={`mf-${p.id}`} {...mapProduct(p)} />)}
                </div>
            </section>
        )}

        {/* 4. RIFTBOUND: DESTACADOS */}
        {siteConfig.features?.showRiftbound && riftFeatured && riftFeatured.length > 0 && (
            <section className="space-y-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                    <h2 className="text-2xl font-bold text-[#1C1B22] flex items-center gap-2">
                        <Crown className="text-amber-500"/> Destacados Riftbound
                    </h2>
                    <Link href="/catalog?tcg=Riftbound&sort=price_desc" className="text-sm font-bold text-slate-500 hover:text-[#9D1B1B] flex items-center gap-1 transition-colors group">
                        Ver cartas caras <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform"/>
                    </Link>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {riftFeatured.map((p: any) => <ProductCard key={`rf-${p.id}`} {...mapProduct(p)} />)}
                </div>
            </section>
        )}

        {/* 5. OTROS PRODUCTOS */}
        {siteConfig.features?.showAccessories && accessories && accessories.length > 0 && (
            <section className="space-y-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                    <h2 className="text-2xl font-bold text-[#1C1B22] flex items-center gap-2">
                        <Package className="text-blue-500"/> Otros Productos
                    </h2>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {accessories.map((p: any) => <ProductCard key={`acc-${p.id}`} {...mapProduct(p)} />)}
                </div>
            </section>
        )}

        <div className="flex justify-center mt-12 pt-8">
          <Link href="/catalog" className="px-8 py-4 bg-[#1C1B22] text-white font-bold rounded-xl hover:bg-slate-900 transition-all shadow-xl hover:scale-105 flex items-center gap-2">
            Explorar todo el inventario <ArrowRight size={20}/>
          </Link>
        </div>
      </div>
    </div>
  )
}
