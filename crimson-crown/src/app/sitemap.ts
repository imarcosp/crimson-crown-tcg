import { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'

// 1. FORZAR DINAMISMO: Esto obliga a Next.js a regenerar el sitemap en cada petición
export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://elpercherotcg.com'

  // Rutas estáticas (siempre deben estar)
  const routes: MetadataRoute.Sitemap = [
    '',
    '/catalog',
    '/login',
    '/register',
  ].map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: 'daily',
    priority: route === '' ? 1 : 0.8,
  }))

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    // Si faltan claves, devolvemos solo lo estático y avisamos en consola
    if (!supabaseUrl || !supabaseKey) {
      console.error('⚠️ ALERTA SITEMAP: Falta SUPABASE_SERVICE_ROLE_KEY en .env.local')
      return routes
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Usamos 'created_at' que es más seguro que 'updated_at'
    const { data: products, error } = await supabase
      .from('products')
      .select('id, created_at') 
      .order('created_at', { ascending: false })
      .limit(45000)

    if (error) {
      console.error('❌ Error SITEMAP SQL:', error.message)
      return routes
    }

    const productUrls = (products || []).map((product) => ({
      url: `${baseUrl}/product/${product.id}`,
      lastModified: new Date(product.created_at || new Date()),
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    }))

    console.log(`✅ Sitemap generado: ${routes.length} estáticas + ${productUrls.length} productos`)
    
    return [...routes, ...productUrls]

  } catch (e) {
    console.error('❌ Error fatal en sitemap:', e)
    return routes
  }
}