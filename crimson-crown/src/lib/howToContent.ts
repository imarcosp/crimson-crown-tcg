export type HowToFaqItem = {
  question: string
  answer: string
}

export type HowToStepItem = {
  title: string
  description: string
}

export type HowToSection = {
  badge: string
  title: string
  description: string
  bullets: string[]
  ctaLabel: string
  ctaHref?: string
  steps?: HowToStepItem[]
}

export type HowToContent = {
  heroTitleStart: string
  heroTitleHighlight: string
  heroTitleEnd: string
  heroDescription: string
  faqTitle: string
  stock: HowToSection
  imports: HowToSection
  moxfield: HowToSection
  sell: HowToSection
  faqs: HowToFaqItem[]
}

export const DEFAULT_HOW_TO_CONTENT: HowToContent = {
  heroTitleStart: "¿Cómo funciona",
  heroTitleHighlight: "Crimson Crown",
  heroTitleEnd: "?",
  heroDescription: "Tu hub definitivo para TCGs. Compra stock, importa listas completas o véndenos tus cartas.",
  faqTitle: "Preguntas Frecuentes",
  stock: {
    badge: "Lo clásico",
    title: "1. Compra Stock Local",
    description: "Explora nuestro catálogo de cartas que ya tenemos físicamente en Argentina. Sin esperas, despacho inmediato.",
    bullets: [
      "Envíos a todo el país.",
      "Enviós gratis en pedidos mayores a 75 USD.",
    ],
    ctaLabel: "Ver Catálogo",
    ctaHref: "/catalog",
  },
  imports: {
    badge: "Especialidad",
    title: "2. Pedidos al Exterior (Manual)",
    description: "¿Buscas cartas específicas? Usa nuestro buscador integrado con precios de Card Kingdom y Coolstuffinc para cotizar al instante.",
    bullets: [],
    ctaLabel: "Pedido a Japón",
    steps: [
      { title: "1. Busca", description: "Busca carta por carta y selecciona la versión (Foil/Normal)." },
      { title: "2. Cotiza", description: "Precio final en dólares con impuestos y envío incluidos." },
      { title: "3. Recibe", description: "Llega en aprox. 15-20 días a nuestras manos." },
    ],
  },
  moxfield: {
    badge: "Automático",
    title: "3. Importá tu lista de Moxfield",
    description: "¿Tienes un mazo commander armado en Moxfield? No busques carta por carta. Pega el link y nuestra herramienta inteligente hará el trabajo sucio.",
    bullets: [
      "Detecta automáticamente qué cartas ya tenemos en Stock Local (compra inmediata).",
      "Separa las cartas que faltan y te permite cotizarlas para Importación en un clic.",
      "Respeta ediciones y foils de tu lista original.",
    ],
    ctaLabel: "Ir al Importador de Mazos",
    ctaHref: "/tools/moxfield",
  },
  sell: {
    badge: "Crédito",
    title: "4. Véndenos tus cartas",
    description: "Convierte las cartas que no usas en crédito para comprar nuevas (o impórtarlas). Pagamos un % competitivo del valor de mercado.",
    bullets: [
      "Cotización rápida.",
      "Bonus extra si eliges crédito en tienda.",
    ],
    ctaLabel: "Ir a la Buylist",
    ctaHref: "/sell",
  },
  faqs: [
    {
      question: "¿Cuánto tarda un pedido al exterior?",
      answer: "Hacemos pedidos Lunes, Miercoles y Viernes. Una vez cerrado, tarda aproximadamente 15 a 20 días en llegar a Argentina y estar listo para despachar.",
    },
    {
      question: "¿Qué métodos de pago aceptan?",
      answer: "Aceptamos transferencia bancaria en pesos (cotización cripto del día), USDT (Cripto) y Efectivo.",
    },
    {
      question: "¿Hacen envíos al interior?",
      answer: "¡Sí! Despachamos a todo el país mediante Correo Argentino. El costo de envío corre por cuenta del comprador.",
    },
    {
      question: "¿Las cartas en stock son reales?",
      answer: "Sí, todo lo que ves en la sección \"Magic: The Gathering\" o \"Riftbound\" está en nuestras carpetas listo para salir.",
    },
  ],
}

function toStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback
  const next = value.map((item) => String(item || '').trim()).filter(Boolean)
  return next.length > 0 ? next : fallback
}

function toStepArray(value: unknown, fallback: HowToStepItem[]) {
  if (!Array.isArray(value)) return fallback
  const next = value
    .map((item) => ({
      title: String((item as any)?.title || '').trim(),
      description: String((item as any)?.description || '').trim(),
    }))
    .filter((item) => item.title || item.description)

  return next.length > 0 ? next : fallback
}

function toFaqArray(value: unknown, fallback: HowToFaqItem[]) {
  if (!Array.isArray(value)) return fallback
  const next = value
    .map((item) => ({
      question: String((item as any)?.question || '').trim(),
      answer: String((item as any)?.answer || '').trim(),
    }))
    .filter((item) => item.question || item.answer)

  return next.length > 0 ? next : fallback
}

function normalizeSection(value: any, fallback: HowToSection): HowToSection {
  return {
    badge: String(value?.badge || fallback.badge),
    title: String(value?.title || fallback.title),
    description: String(value?.description || fallback.description),
    bullets: toStringArray(value?.bullets, fallback.bullets),
    ctaLabel: String(value?.ctaLabel || fallback.ctaLabel),
    ctaHref: String(value?.ctaHref || fallback.ctaHref || ''),
    steps: toStepArray(value?.steps, fallback.steps || []),
  }
}

export function parseHowToContent(raw: unknown): HowToContent {
  let value = raw

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      value = null
    }
  }

  const parsed = (value && typeof value === 'object') ? (value as any) : {}

  return {
    heroTitleStart: String(parsed.heroTitleStart || DEFAULT_HOW_TO_CONTENT.heroTitleStart),
    heroTitleHighlight: String(parsed.heroTitleHighlight || DEFAULT_HOW_TO_CONTENT.heroTitleHighlight),
    heroTitleEnd: String(parsed.heroTitleEnd || DEFAULT_HOW_TO_CONTENT.heroTitleEnd),
    heroDescription: String(parsed.heroDescription || DEFAULT_HOW_TO_CONTENT.heroDescription),
    faqTitle: String(parsed.faqTitle || DEFAULT_HOW_TO_CONTENT.faqTitle),
    stock: normalizeSection(parsed.stock, DEFAULT_HOW_TO_CONTENT.stock),
    imports: normalizeSection(parsed.imports, DEFAULT_HOW_TO_CONTENT.imports),
    moxfield: normalizeSection(parsed.moxfield, DEFAULT_HOW_TO_CONTENT.moxfield),
    sell: normalizeSection(parsed.sell, DEFAULT_HOW_TO_CONTENT.sell),
    faqs: toFaqArray(parsed.faqs, DEFAULT_HOW_TO_CONTENT.faqs),
  }
}
