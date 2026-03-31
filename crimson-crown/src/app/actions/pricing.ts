"use server"
import * as cheerio from 'cheerio'

function toSlug(text: string) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
}

type CKPrices = { NM: number | null; EX: number | null; VG: number | null; G: number | null }

export async function getCardKingdomPrices(cardName: string, setName: string, basePrice?: number) {
  try {
    const slugName = toSlug(cardName)
    const slugSet = toSlug(setName)
    const url = `https://www.cardkingdom.com/mtg/${slugSet}/${slugName}`

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      next: { revalidate: 3600 },
    })

    if (!response.ok) {
      const fallback = fallbackFromBase(basePrice)
      return { success: true, url, prices: fallback }
    }

    const html = await response.text()
    if (/Sudden Disappearance/i.test(html)) {
      const fallback = fallbackFromBase(basePrice)
      return { success: true, url, prices: fallback }
    }

    const $ = cheerio.load(html)
    const prices: { NM: number; EX: number; VG: number; G: number } = { NM: 0, EX: 0, VG: 0, G: 0 }

    $('.productItemWrapper, .productDetailSetList li, .productItem, .product-item, .variantRow').each((_, el) => {
      const conditionText = ($(el).find('.conditionAbbrev, .condition, .styleCondition').text() || $(el).text()).trim().toUpperCase()
      let priceText = $(el).find('.stylePrice, .sellPrice, .price, .stylePriceOutOfStock').first().text().trim()
      if (!priceText) {
        const match = ($(el).text().match(/\$\s*([0-9]+(?:\.[0-9]{1,2})?)/) || [])[1]
        if (match) priceText = `$${match}`
      }
      if (!conditionText || !priceText) return
      const cleanPrice = parseFloat(priceText.replace(/[^0-9.]/g, ''))
      if (isNaN(cleanPrice) || cleanPrice <= 0) return
      if (conditionText.includes('NM')) prices.NM = prices.NM || cleanPrice
      else if (conditionText.includes('EX') || conditionText.includes('SP')) prices.EX = prices.EX || cleanPrice
      else if (conditionText.includes('VG')) prices.VG = prices.VG || cleanPrice
      else if (/(^|\W)G(\W|$)/.test(conditionText)) prices.G = prices.G || cleanPrice
    })

    const allZero = !prices.NM && !prices.EX && !prices.VG && !prices.G
    const normalized: CKPrices = allZero ? fallbackFromBase(basePrice) : {
      NM: prices.NM || fallbackFromBase(basePrice).NM,
      EX: prices.EX || fallbackFromBase(basePrice).EX,
      VG: prices.VG || fallbackFromBase(basePrice).VG,
      G: prices.G || fallbackFromBase(basePrice).G,
    }

    return { success: true, url, prices: normalized }
  } catch (error) {
    const fallback = fallbackFromBase(basePrice)
    return { success: true, error: 'Error de conexión', prices: fallback }
  }
}

function fallbackFromBase(base?: number): CKPrices {
  const b = Number(base || 0)
  if (!b || b <= 0) return { NM: 0, EX: 0, VG: 0, G: 0 }
  const round = (n: number) => Math.round(n * 100) / 100
  return {
    NM: round(b * 1.0),
    EX: round(b * 0.85),
    VG: round(b * 0.75),
    G: round(b * 0.6),
  }
}
