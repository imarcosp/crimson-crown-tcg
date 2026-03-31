export function getCardImageUrl(pathOrUrl: string | undefined | null): string {
  if (!pathOrUrl) return '/placeholder.png'
  
  // 1. Si es una URL completa (http/https), la devolvemos tal cual (ej: Scryfall)
  if (pathOrUrl.startsWith('http')) return pathOrUrl
  
  // 2. Si es una imagen placeholder local
  if (pathOrUrl.startsWith('/')) return pathOrUrl

  // 3. Si es un nombre de archivo, asumimos que está en el bucket 'products' de Supabase
  // Construimos la URL pública manualmente para evitar dependencias circulares del cliente aquí,
  // o asumimos una estructura estándar.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) return pathOrUrl // Fallback si no hay env

  // Limpiamos la ruta por si viene con 'products/' al inicio
  const cleanPath = pathOrUrl.replace(/^products\//, '')
  
  return `${supabaseUrl}/storage/v1/object/public/products/${cleanPath}`
}
