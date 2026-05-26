import { MetadataRoute } from 'next'
import { siteConfig } from '@/config/site'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || siteConfig.url

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
