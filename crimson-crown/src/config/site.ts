type SiteConfig = {
  name: string
  shortName: string
  description: string
  url: string
  logo: string
  socialImage: string
  socialLinks: {
    instagram: string
    whatsapp: string
    email: string
  }
  payment: {
    bankOwner: string
    bankName: string
    bankAliasArs: string
    bankCbuArs: string
  }
  theme: {
    primary: string
    accent: string
    accentHover: string
    gold: string
  }
  features: {
    showRiftbound: boolean
    showSecretLair: boolean
    showAccessories: boolean
    showSealed: boolean
  }
}

export function buildSiteConfig(isLocal: boolean): SiteConfig {
  const common = {
    name: 'Crimson Crown TCG',
    shortName: 'Crimson Crown',
    logo: '/logo.webp?v=crimson1',
    socialImage: '/opengraph-image.png?v=crimson1',
    theme: {
      primary: '#1C1B22',
      accent: '#9D1B1B',
      accentHover: '#7E1515',
      gold: '#C7A316',
    },
    features: {
      showRiftbound: false,
      showSecretLair: false,
      showAccessories: false,
      showSealed: false,
    },
  }

  if (isLocal) {
    return {
      ...common,
      description: 'Crimson Crown local test store',
      url: 'http://127.0.0.1:3000',
      socialLinks: {
        instagram: '/local-test/instagram',
        whatsapp: '5491100000000',
        email: 'contact@example.test',
      },
      payment: {
        bankOwner: 'Local Test Account',
        bankName: 'Local Test Bank',
        bankAliasArs: 'local-test',
        bankCbuArs: '0000000000000000000000',
      },
    }
  }

  return {
    ...common,
    description: 'Tu tienda especializada en Magic: The Gathering.',
    url: 'https://www.crimsoncrownimports.com',
    socialLinks: {
      instagram: 'https://www.instagram.com/elpercherotcg/',
      whatsapp: '5491123510593',
      email: 'crimsoncrownimports@gmail.com',
    },
    payment: {
      bankOwner: 'Facundo Ezequiel Lira Rodríguez',
      bankName: 'Mercado Pago',
      bankAliasArs: 'coronamtg',
      bankCbuArs: '0000003100018685270995',
    },
  }
}

function isLoopbackSupabaseUrl(supabaseUrl: string | undefined): boolean {
  if (!supabaseUrl) return false

  try {
    const hostname = new URL(supabaseUrl).hostname.toLowerCase()
    return hostname === '127.0.0.1' || hostname === 'localhost'
  } catch {
    return false
  }
}

export const siteConfig = buildSiteConfig(
  isLoopbackSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),
)

export type { SiteConfig }
