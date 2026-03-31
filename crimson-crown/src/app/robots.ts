import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://elpercherotcg.com'

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/admin/',
        '/profile/',
        '/api/',
        '/auth/',
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}