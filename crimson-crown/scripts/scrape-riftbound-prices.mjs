import 'dotenv/config'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs/promises'
import path from 'node:path'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Faltan variables de entorno de Supabase.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const MIN_PRICE = 0.35

function getMinPrice(rarity, isFoil) {
    const r = String(rarity || '').toLowerCase()
    
    if (isFoil) {
        if (r.includes('common') && !r.includes('uncommon')) return 0.99
        if (r.includes('uncommon')) return 1.99
    }
    
    return MIN_PRICE
}
const DRY_RUN = String(process.env.DRY_RUN || '').toLowerCase() === 'true'
const ONLY_NAME = (process.env.ONLY_NAME || '').trim()
const DEBUG_DUMP = String(process.env.DEBUG_DUMP || '').toLowerCase() === 'true'

const changeLog = []
const zeroPriceLog = []

function cleanPrice(str) {
    if (!str) return 0
    const cleanStr = str.replace(/,/g, '')
    const match = cleanStr.match(/[\d\.]+/)
    return match ? parseFloat(match[0]) : 0
}

function humanDelay(min = 2000, max = 4000) {
    return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min))
}

function normalizeLoose(str) {
  return String(str || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function splitSetAndCollector(rawSetName) {
  const s = String(rawSetName || '').trim()
  if (!s) return { set_name: '', collector_number: '' }
  const m1 = s.match(/^(.*?)[\s:,-]*#\s*([0-9a-zA-Z\/\.\-]+)\s*$/)
  if (m1) return { set_name: String(m1[1] || '').trim(), collector_number: String(m1[2] || '').trim() }
  const m2 = s.match(/^(.*?)[\s:,-]+([0-9]+\/[0-9]+)\s*$/)
  if (m2) return { set_name: String(m2[1] || '').trim(), collector_number: String(m2[2] || '').trim() }
  return { set_name: s, collector_number: '' }
}

async function ensureDebugDir() {
  const dir = path.resolve(process.cwd(), 'scripts', 'debug')
  try { await fs.mkdir(dir, { recursive: true }) } catch {}
  return dir
}

async function dumpDebug(page, prefix) {
  try {
    const dir = await ensureDebugDir()
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const safe = String(prefix || 'debug').replace(/[^a-z0-9]+/gi, '-').slice(0, 80)
    const base = path.join(dir, `${ts}-${safe}`)
    await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {})
    const html = await page.content().catch(() => '')
    if (html) await fs.writeFile(`${base}.html`, html, 'utf8').catch(() => {})
    const info = {
      url: page.url(),
      title: await page.title().catch(() => ''),
    }
    await fs.writeFile(`${base}.json`, JSON.stringify(info, null, 2), 'utf8').catch(() => {})
  } catch {}
}

// ---------------------------------------------------------
// SCRAPER COOLSTUFFINC
// ---------------------------------------------------------
async function scrapeCSI(page, targetName, isFoil, expectedSetName, expectedCollectorNumber) {
    const q = encodeURIComponent(targetName).replace(/%20/g, '+')
    const url = `https://www.coolstuffinc.com/main_search.php?pa=searchOnName&page=1&resultsPerPage=25&q=${q}`
    const targetNormalized = normalizeLoose(targetName)

    try {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
        
        // Esperamos selectores clave para confirmar carga real (o bloqueo explícito)
        try {
            await Promise.race([
                page.waitForSelector('.search-result-item, .product, .main-content, #main-content, .breadcrumb-trail', { timeout: 15000 }),
                page.waitForSelector('.no-results-message, .no_results, .alert-warning', { timeout: 15000 }),
                page.waitForSelector('iframe[src*="cloudflare"], #challenge-form', { timeout: 15000 })
            ])
        } catch (e) {
            // Si timeout, seguimos para chequear bodyLen
        }

        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
        await humanDelay(1500, 2500)

        // Verificamos si Cloudflare nos bloqueó
        const title = await page.title().catch(() => '')
        if (title.includes('Just a moment') || title.includes('Cloudflare')) {
            console.log(`     🛑 BLOQUEO ANTI-BOT en CSI.`)
            await dumpDebug(page, `csi-blocked-${targetName}`)
            return 0
        }
        if (!resp || (resp.status && resp.status() >= 400)) {
            console.log(`     ⚠️ CSI respondió status ${(resp && resp.status && resp.status()) || 'N/A'}`)
            await dumpDebug(page, `csi-http-${targetName}`)
            return 0
        }

        let bodyLen = await page.evaluate(() => (document.body?.innerText || '').trim().length)
        if (!bodyLen) {
            // Retry una vez con networkidle (algunos casos cargan tarde o hacen redirect)
            try {
              await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 })
              await humanDelay(1200, 1800)
              bodyLen = await page.evaluate(() => (document.body?.innerText || '').trim().length)
            } catch {}
        }
        if (!bodyLen) {
            console.log(`     ⚠️ CSI devolvió página vacía (posible challenge/redirect).`)
            await dumpDebug(page, `csi-empty-${targetName}`)
            return 0
        }

        const productUrl = await page.evaluate(({ targetNormalized, expectedSetName }) => {
            const normalizeLooseInPage = (s) => String(s || '').normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')
            const tokenize = (s) => String(s || '').normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(Boolean).filter(t => t !== 'riftbound')
            const includesAllTokens = (raw, tokens) => {
              if (!tokens || tokens.length === 0) return true
              const n = String(raw || '').normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ')
              return tokens.every(t => n.includes(t))
            }
            const isRiftboundContainer = (el) => {
              const raw = String(el?.textContent || '').toLowerCase()
              if (!raw.includes('riftbound')) return false
              return raw.includes('»') || raw.includes('›') || raw.includes('>>')
            }
            const expTokens = tokenize(expectedSetName || '')
            const promoWords = ['promo', 'promotional', 'promos', 'prerelease']
            const expectedHasPromo = expTokens.some(tok => promoWords.includes(tok))

            const anchors = Array.from(document.querySelectorAll('a[href]'))
            const candidates = anchors
              .map(a => ({ href: a.getAttribute('href'), text: a.textContent || '', el: a }))
              .filter(x => x.href && x.text && normalizeLooseInPage(x.text).includes(targetNormalized))
              .filter(x => {
                // Buscamos el contenedor principal de la carta.
                let container = x.el.closest('.product-search-row, .search-result-item, .product, .item')
                if (!container) container = x.el.closest('.row') || x.el.parentElement
                
                if (!isRiftboundContainer(container)) return false
                
                const raw = String(container?.textContent || '').toLowerCase()
                const containerHasPromo = promoWords.some(w => raw.includes(w))
                if (expectedHasPromo && !containerHasPromo) return false
                if (!expectedHasPromo && containerHasPromo) return false

                if (expTokens.length === 0) return true
                return includesAllTokens(container?.textContent || '', expTokens)
              })
            if (candidates.length === 0) return null
            const first = candidates[0].href
            if (!first) return null
            if (first.startsWith('http')) return first
            if (first.startsWith('/')) return `https://www.coolstuffinc.com${first}`
            return `https://www.coolstuffinc.com/${first}`
        }, { targetNormalized, expectedSetName })

        const currentUrl = page.url()
        const isSearchPage = currentUrl.includes('main_search.php') || currentUrl.includes('q=')

        if (isSearchPage && !productUrl) {
            // Si seguimos en la página de búsqueda y no encontramos un link válido a producto Riftbound,
            // significa que NO encontramos la carta en la lista. Devolvemos 0.
            console.log(`     ⚠️ No se encontró link de producto Riftbound en búsqueda.`)
            await dumpDebug(page, `csi-nosearch-${targetName}`)
            return 0
        }

        if (productUrl) {
            await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
            await humanDelay(1200, 2000)
        }

        const price = await page.evaluate(({ targetNormalized, isFoil, expectedSetName, expectedCollectorNumber }) => {
            const normalizeLooseInPage = (s) => String(s || '').normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')
            const tokenize = (s) => String(s || '').normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(Boolean).filter(t => t !== 'riftbound')
            const includesAllTokens = (raw, tokens) => {
              if (!tokens || tokens.length === 0) return true
              const n = String(raw || '').normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ')
              return tokens.every(t => n.includes(t))
            }
            const isRiftboundText = (raw) => {
              const t = String(raw || '').toLowerCase()
              if (!t.includes('riftbound')) return false
              return t.includes('»') || t.includes('›') || t.includes('>>')
            }
            
            // Re-declaramos expCn dentro del contexto del navegador
            const expCn = normalizeLooseInPage(expectedCollectorNumber || '')
            
            // VALIDACIÓN ESTRICTA DE PROMOS:
            // Si el set esperado contiene "promo", "promotional", "prerelease", etc.
            // exigimos que el breadcrumb o el set en la página también lo contenga.
            // Y viceversa: si no esperamos promo, descartamos si dice promo.
            const promoWords = ['promo', 'promotional', 'promos', 'prerelease']
            const expSetTokens = tokenize(expectedSetName || '')
            const expectedHasPromo = expSetTokens.some(tok => promoWords.includes(tok))
            
            const trails = Array.from(document.querySelectorAll('.breadcrumb-trail')).map(el => String(el?.textContent || ''))
            const breadcrumb = trails.find(t => isRiftboundText(t)) || ''
            if (!breadcrumb) return 0

            const breadcrumbLower = breadcrumb.toLowerCase()
            const breadcrumbHasPromo = promoWords.some(w => breadcrumbLower.includes(w))

            if (expectedHasPromo && !breadcrumbHasPromo) return 0
            if (!expectedHasPromo && breadcrumbHasPromo) return 0
            
            // Validación de Set: Primero en breadcrumb, luego en .ItemSet (común en páginas de producto)
            if (expSetTokens.length > 0 && !includesAllTokens(breadcrumb, expSetTokens)) {
                const itemSetText = document.querySelector('.ItemSet')?.textContent || ''
                if (!includesAllTokens(itemSetText, expSetTokens)) {
                     // Si no está ni en breadcrumb ni en ItemSet, asumimos que no es la carta correcta (o es otra impresión)
                     return 0
                }
            }

            const extractFromText = (raw, wantFoil) => {
              const t0 = String(raw || '').toLowerCase().replace(/\s+/g, ' ')
              const hits = []
              const reNearMint = /((foil\s+)?near\s+mint)[^$]{0,80}\$\s*([0-9]+(?:\.[0-9]+)?)/ig
              let m
              while ((m = reNearMint.exec(t0)) !== null) {
                const isFoilHit = !!m[2]
                const price = parseFloat(m[3])
                if (price > 0) hits.push({ foil: isFoilHit, price })
              }
              if (wantFoil) {
                const h = hits.find(x => x.foil)
                if (h) return h.price
              } else {
                const h = hits.find(x => !x.foil)
                if (h) return h.price
              }

              const reNm = /((foil\s+)?nm)\b[^$]{0,80}\$\s*([0-9]+(?:\.[0-9]+)?)/ig
              while ((m = reNm.exec(t0)) !== null) {
                const isFoilHit = !!m[2]
                const price = parseFloat(m[3])
                if (price > 0) hits.push({ foil: isFoilHit, price })
              }
              if (wantFoil) {
                const h = hits.find(x => x.foil)
                if (h) return h.price
              } else {
                const h = hits.find(x => !x.foil)
                if (h) return h.price
              }
              return 0
            }

            const rawPage = String(document.body?.textContent || '')
            if (!isRiftboundText(rawPage)) return 0
            if (expSetTokens.length > 0 && !includesAllTokens(rawPage, expSetTokens)) return 0
            if (expCn) {
              const hasCnInfo = /#\s*[0-9a-z]/i.test(rawPage) || /\b[0-9]+\/[0-9]+\b/.test(rawPage)
              if (hasCnInfo && !normalizeLooseInPage(rawPage).includes(expCn)) return 0
            }

            const direct = extractFromText(rawPage, isFoil)
            if (direct > 0) return direct

            const readPriceFrom = (el) => {
              if (!el) return 0
              const content = el.getAttribute && el.getAttribute('content')
              const txt = String(content || el.textContent || '').replace(/,/g, '')
              const m = txt.match(/([0-9]+(?:\.[0-9]+)?)/)
              return m ? parseFloat(m[1]) : 0
            }
            const parseOffers = (root) => {
              // Estrategia 1: Microdata schema.org
              const offers = Array.from(root.querySelectorAll('[itemprop="offers"]'))
              const list = []
              for (const offer of offers) {
                const descMeta = offer.querySelector && offer.querySelector('meta[itemprop="description"]')
                const desc = String(descMeta?.getAttribute?.('content') || '')
                const text = String(offer.textContent || '')
                const combined = (desc + ' ' + text).toLowerCase().replace(/\s+/g, ' ')
                
                // Filtro de condición
                if (!combined.includes('near mint') && !combined.includes(' nm')) continue
                
                const isFoilOffer = combined.includes('foil near mint') || combined.includes('foil nm') || combined.includes(' foil ')
                const avail = offer.querySelector && offer.querySelector('[itemprop="availability"]')
                const availContent = String(avail?.getAttribute?.('content') || '').toLowerCase()
                const out = availContent.includes('outofstock') || combined.includes('out of stock') || combined.includes('sold out')
                const priceEl = offer.querySelector && offer.querySelector('[itemprop="price"]')
                const price = readPriceFrom(priceEl)
                if (price > 0) list.push({ price, out, isFoilOffer })
              }
              
              // Estrategia 2: Tabla de Variantes (Clases CSS específicas de CSI)
              // .product-variants, .variant-row, etc.
              const variants = Array.from(root.querySelectorAll('tr.product-search-row, tr.variantRow, tr[class*="product"]'))
              for (const v of variants) {
                  const rawRow = String(v.textContent || '').toLowerCase().replace(/\s+/g, ' ')
                  
                  // Validación visual: "20+ Near Mint $0.75"
                  // Buscamos si la fila dice "Near Mint"
                  if (!rawRow.includes('near mint') && !rawRow.includes(' nm')) continue
                  if (rawRow.includes('played')) continue // Evitar "Played"

                  // Determinar si es foil por el texto de la fila o nombre del producto
                  const isFoilRow = rawRow.includes('foil')

                  // Extraer precio
                  const priceMatch = rawRow.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/)
                  const price = priceMatch ? parseFloat(priceMatch[1]) : 0

                  // Chequear stock (si dice Out of Stock o Sold Out)
                  const out = rawRow.includes('out of stock') || rawRow.includes('sold out')
                  
                  if (price > 0) list.push({ price, out, isFoilOffer: isFoilRow })
              }

              // Estrategia 3: Bloques de items (grid view)
              const items = Array.from(root.querySelectorAll('.search-result-item, .product-card'))
              for (const item of items) {
                  const raw = String(item.textContent || '').toLowerCase().replace(/\s+/g, ' ')
                   if (!raw.includes('near mint') && !raw.includes(' nm')) continue
                   if (raw.includes('played')) continue
                   
                   const isFoilItem = raw.includes('foil')
                   const priceMatch = raw.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/)
                   const price = priceMatch ? parseFloat(priceMatch[1]) : 0
                   const out = raw.includes('out of stock') || raw.includes('sold out')
                   if (price > 0) list.push({ price, out, isFoilOffer: isFoilItem })
              }

              if (list.length === 0) return 0
              
              // Filtrar por lo que queremos (Foil vs Normal)
              // Priorizamos match exacto de foil
              let want = list.filter(x => (isFoil ? x.isFoilOffer : !x.isFoilOffer))
              
              // Si no encontramos match exacto y estamos buscando NORMAL,
              // asegurarnos de NO tomar foil.
              if (!isFoil) {
                  want = want.filter(x => !x.isFoilOffer)
              }
              
              const pool = want.length ? want : []
              const inStock = pool.filter(x => !x.out)
              const pick = (inStock.length ? inStock : pool).sort((a, b) => a.price - b.price)[0]
              return pick?.price || 0
            }
            const offerPrice = parseOffers(document)
            if (offerPrice > 0) return offerPrice

            // Caso resultados: buscar candidatos y extraer precio dentro del contenedor del candidato
            const anchors = Array.from(document.querySelectorAll('a[href]'))
            // VALIDACIÓN ESTRICTA DE PROMOS EN CSI (Resultados de búsqueda)
            // Reutilizamos promoWords y expSetTokens definidos arriba
            
            const candidates = anchors
              .filter(a => {
                const t = normalizeLooseInPage(a.textContent || '')
                if (!t.includes(targetNormalized)) return false
                return true
              })
              .filter(a => {
                const container = a.closest('.search-result-item, .row, .product, .item') || a.parentElement
                const raw = String(container?.textContent || '')
                if (!isRiftboundText(raw)) return false
                
                // Validación Promo Estricta
                const rawLower = raw.toLowerCase()
                const containerHasPromo = promoWords.some(w => rawLower.includes(w))
                if (expectedHasPromo && !containerHasPromo) return false
                if (!expectedHasPromo && containerHasPromo) return false

                if (expSetTokens.length > 0 && !includesAllTokens(raw, expSetTokens)) return false
                if (expCn) {
                  const hasCnInfo = /#\s*[0-9a-z]/i.test(raw) || /\b[0-9]+\/[0-9]+\b/.test(raw)
                  if (hasCnInfo && !normalizeLooseInPage(raw).includes(expCn)) return false
                }
                return true
              })

            let best = 0
            for (const a of candidates.slice(0, 25)) {
              const container = a.closest('.search-result-item, .row, .product, .item') || a.parentElement
              const raw = String(container?.textContent || '')
              const v = extractFromText(raw, isFoil)
              if (v > 0 && (best === 0 || v < best)) best = v
            }

            return best
        }, { targetNormalized, isFoil, expectedSetName, expectedCollectorNumber })

        if (DEBUG_DUMP) {
          if (price > 0) await dumpDebug(page, `csi-price-${targetName}-${price}`)
          else await dumpDebug(page, `csi-noprice-${targetName}`)
        }
        return { price: price || 0 }
    } catch (e) {
        console.log(`     ⚠️ Error en CSI: ${e.message.split('\n')[0]}`)
        await dumpDebug(page, `csi-error-${targetName}`)
        return { price: 0 }
    }
}

// ---------------------------------------------------------
// SCRAPER TCGPLAYER (Click-through)
// ---------------------------------------------------------
async function scrapeTCG(page, targetName, isFoil, expectedSetName, expectedCollectorNumber) {
    // Para TCGPlayer, conservamos los guiones en la URL pero codificados
    const nameForURL = encodeURIComponent(targetName)
    const searchUrl = `https://www.tcgplayer.com/search/all/product?q=${nameForURL}`
    const targetNormalized = normalizeLoose(targetName)

    try {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
        await humanDelay(2000, 3000)

        const title = await page.title().catch(() => '')
        if (title.includes('Just a moment') || title.includes('Access Denied')) {
            console.log(`     🛑 BLOQUEO ANTI-BOT en TCGPlayer.`)
            await dumpDebug(page, `tcg-blocked-${targetName}`)
            return { price: 0 }
        }

        try {
          await page.waitForSelector('a[href*="/product/"]', { timeout: 15000 })
        } catch {
          const bodyLen = await page.evaluate(() => (document.body?.innerText || '').trim().length)
          if (!bodyLen) {
            console.log(`     ⚠️ TCG devolvió página vacía (posible challenge/redirect).`)
            await dumpDebug(page, `tcg-empty-${targetName}`)
          } else {
            console.log(`     ⚠️ TCG no cargó resultados a tiempo.`)
            await dumpDebug(page, `tcg-noresults-${targetName}`)
          }
          return { price: 0 }
        }

        const candidatePaths = await page.evaluate(({ targetNormalized, isFoil, expectedSetName, expectedCollectorNumber }) => {
            const normalizeLooseInPage = (s) => String(s || '').normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')
            const tokenize = (s) => String(s || '').normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(Boolean).filter(t => t !== 'riftbound')
            const includesAllTokens = (raw, tokens) => {
              if (!tokens || tokens.length === 0) return true
              const n = String(raw || '').normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ')
              return tokens.every(t => n.includes(t))
            }
            const expSetTokens = tokenize(expectedSetName || '')
            const expCn = normalizeLooseInPage(expectedCollectorNumber || '')
            const promoWords = ['promo', 'promotional', 'promos', 'prerelease']
            const expectedHasPromo = expSetTokens.some(tok => promoWords.includes(tok))
            const anchors = Array.from(document.querySelectorAll('a[href*="/product/"]'))
            const hits = []
            for (const a of anchors) {
              const txt = (a.textContent || '').trim()
              if (!txt) continue
              const n = normalizeLooseInPage(txt)
              const container = a.closest('div') || a.parentElement
              const containerText = normalizeLooseInPage(container?.textContent || '')
              const foilHint = containerText.includes('foil')
              const exact = n === targetNormalized
              const includes = n.includes(targetNormalized)
              if (!exact && !includes) continue
              const href = a.getAttribute('href')
              if (!href) continue
              const hrefNorm = String(href).toLowerCase()
              const setOk = expSetTokens.length === 0 ? true : includesAllTokens(container?.textContent || '', expSetTokens)
              const cnOk = !expCn || containerText.includes(expCn)
              const containerRaw = String(container?.textContent || '').toLowerCase()
              const containerHasPromo = promoWords.some(w => containerRaw.includes(w))
              if (!expectedHasPromo && containerHasPromo) continue
              const score =
                (exact ? 3 : 1) +
                (containerText.includes('riftbound') ? 2 : 0) +
                (hrefNorm.includes('riftbound') ? 3 : 0) +
                ((isFoil && foilHint) || (!isFoil && !foilHint) ? 1 : 0) +
                (setOk ? 3 : -2) +
                (cnOk ? 4 : 0)
              hits.push({ href, score })
            }
            hits.sort((a, b) => b.score - a.score)
            return hits.slice(0, 8).map(h => h.href)
        }, { targetNormalized, isFoil, expectedSetName, expectedCollectorNumber })

        if (!candidatePaths || candidatePaths.length === 0) {
            await dumpDebug(page, `tcg-nomatch-${targetName}`)
            return { price: 0 }
        }

        let fullProductUrl = ''
        let foundRiftbound = false
        let tcgId = null

        for (const productPath of candidatePaths) {
            fullProductUrl = productPath.startsWith('http') ? productPath : `https://www.tcgplayer.com${productPath}`
            if (isFoil && !/[\?&]Printing=Foil\b/i.test(fullProductUrl)) {
              fullProductUrl += (fullProductUrl.includes('?') ? '&' : '?') + 'Printing=Foil'
            }
            console.log(`     ➡️ Entrando a TCGPlayer Producto...`)
            await page.goto(fullProductUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
            await humanDelay(1200, 2000)
            const currentUrl = page.url().toLowerCase()
            const urlLooksRiftbound = currentUrl.includes('/riftbound-') || currentUrl.includes('/riftbound%') || currentUrl.includes('/riftbound?') || currentUrl.includes('/riftbound/')
            const hasRiftText = await page.evaluate(() => String(document.body?.textContent || '').toLowerCase().includes('riftbound')).catch(() => false)
            const isRift = urlLooksRiftbound && hasRiftText
            if (isRift) {
                foundRiftbound = true
                const m = currentUrl.match(/\/product\/(\d+)\//) || currentUrl.match(/productid=(\d+)/)
                if (m) tcgId = m[1]
                break
            }
        }
        if (!foundRiftbound) {
            await dumpDebug(page, `tcg-wronggame-${targetName}`)
            return { price: 0 }
        }

        // Si hay selector de variante/foil, intentamos seleccionarla
        if (isFoil) {
          try {
            const foilBtn = page.locator('button:has-text("Foil")').first()
            if (await foilBtn.isVisible({ timeout: 2000 })) {
              await foilBtn.click({ timeout: 2000 })
              await humanDelay(700, 1200)
            }
          } catch {}
          try {
            const sel = page.locator('select').filter({ hasText: /Foil/i }).first()
            if (await sel.isVisible({ timeout: 1500 })) {
              await sel.selectOption({ label: /Foil/i })
              await humanDelay(700, 1200)
            }
          } catch {}
        }

        try { await page.waitForSelector('text=/Listed Median/i', { timeout: 15000 }) } catch {}

        const finalPrice = await page.evaluate(() => {
            const pageText = String(document.body?.textContent || '').toLowerCase()
            const url = String(location.href || '').toLowerCase()
            const urlLooksRiftbound = url.includes('/riftbound-') || url.includes('/riftbound%') || url.includes('/riftbound?') || url.includes('/riftbound/')
            if (!urlLooksRiftbound) return 0
            if (!pageText.includes('riftbound')) return 0
            const extractAfterLabel = (text, label) => {
              const t = String(text || '')
              const idx = t.toLowerCase().indexOf(label.toLowerCase())
              if (idx < 0) return 0
              const after = t.slice(idx + label.length)
              const m = after.replace(/,/g, '').match(/\$?\s*([\d]+(?:\.[\d]+)?)/)
              return m ? parseFloat(m[1]) : 0
            }

            const all = Array.from(document.querySelectorAll('body *'))
            for (const el of all) {
              const t = (el.textContent || '').trim()
              if (!t) continue
              if (t.toLowerCase().includes('listed median')) {
                const v = extractAfterLabel(t, 'listed median')
                if (v > 0) return v
                const parentText = el.parentElement?.textContent || ''
                const pv = extractAfterLabel(parentText, 'listed median')
                if (pv > 0) return pv
              }
            }

            for (const el of all) {
              const t = (el.textContent || '').trim()
              if (!t) continue
              if (t.toLowerCase().includes('market price')) {
                const v = extractAfterLabel(t, 'market price')
                if (v > 0) return v
                const parentText = el.parentElement?.textContent || ''
                const pv = extractAfterLabel(parentText, 'market price')
                if (pv > 0) return pv
              }
            }

            return 0
        })

        if (DEBUG_DUMP) {
          if (finalPrice > 0) await dumpDebug(page, `tcg-product-${targetName}`)
          else await dumpDebug(page, `tcg-noprice-${targetName}`)
        }
        return { price: finalPrice || 0, tcgId }
    } catch (e) {
        console.log(`     ⚠️ Error en TCGPlayer: ${e.message.split('\n')[0]}`)
        await dumpDebug(page, `tcg-error-${targetName}`)
        return { price: 0 }
    }
}


// ---------------------------------------------------------
// FUNCIÓN PRINCIPAL
// ---------------------------------------------------------
async function main() {
  console.log('🚀 Iniciando Scraper V4 (CSI + TCGPlayer Listed Median)...')

  // 1. OBTENER TODAS LAS CARTAS (Superando el límite de 1000)
  // 1. OBTENER TODAS LAS CARTAS (Paginación)
   let allCards = []
   let hasMore = true
   let pageIdx = 0
   const PAGE_SIZE = 1000

   console.log('📥 Descargando inventario de Riftbound...')
   while(hasMore) {
       const { data, error } = await supabase
         .from('products')
         .select('id, name, set_name, collector_number, finish, price_usd, scryfall_id, rarity')
         .eq('tcg', 'Riftbound')
         .range(pageIdx * PAGE_SIZE, ((pageIdx + 1) * PAGE_SIZE) - 1)
         .order('name')
       
       if (error) {
           console.error('Error cargando BD:', error)
           break
       }
       
       if (data && data.length > 0) {
           allCards.push(...data)
       }
       
       if (!data || data.length < PAGE_SIZE) {
           hasMore = false
       }
       pageIdx++
   }

  if (allCards.length === 0) {
      console.log('No se encontraron cartas de Riftbound para actualizar.')
      return
  }

  console.log(`📦 Encontradas ${allCards.length} cartas en total. Iniciando Navegador...`)
  if (DRY_RUN) console.log('🧪 DRY_RUN activo: NO se escribirá en la base de datos.')
  if (ONLY_NAME) console.log(`🔎 Filtro activo ONLY_NAME="${ONLY_NAME}"`)

  // Dejamos headless: false para que veas si Cloudflare te pide resolver captcha manualmente
  const browser = await chromium.launch({ 
      headless: false,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox']
  }) 
  const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
      }
  })
  
  // Script para ocultar que es automatizado (Stealth básico)
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })

  const page = await context.newPage()

  // Pre-calentamiento: Visitar home para cookies/session
  try {
      console.log('🌍 Visitando Home de CSI para inicializar sesión...')
      await page.goto('https://www.coolstuffinc.com', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await humanDelay(2000, 4000)
  } catch (e) {
      console.log('⚠️ Error visitando Home (no crítico):', e.message)
  }

  let updatedCount = 0

  // 2. RECORRER CARTAS
   for (let i = 0; i < allCards.length; i++) {
       const card = allCards[i]
       if (ONLY_NAME && !normalizeLoose(card.name).includes(normalizeLoose(ONLY_NAME))) continue
       const parsedSet = splitSetAndCollector(card.set_name)
      const expectedSetName = parsedSet.set_name || String(card.set_name || '').trim()
      const expectedCollectorNumber = String(card.collector_number || '').trim() || parsedSet.collector_number
      const finishLower = String(card.finish || '').toLowerCase()
      const isFoil = ((finishLower.includes('foil') && !finishLower.includes('non')) || finishLower.includes('etched'))
      const oldPrice = Number(card.price_usd || 0).toFixed(2)
      
      const setLabel = String(card.set_name || '').trim()
      const cnLabel = String(card.collector_number || '').trim()
      const where = setLabel ? `${setLabel}${cnLabel ? ` #${cnLabel}` : ''}` : ''
      console.log(`\n🔍 [${i+1}/${allCards.length}] Buscando: ${card.name}${where ? ` [${where}]` : ''} (${card.finish}) - Precio actual: $${oldPrice}`)

      let finalPrice = 0
      let source = ''

      // INTENTO 1: CoolStuffInc
      const csiResult = await scrapeCSI(page, card.name, isFoil, expectedSetName, expectedCollectorNumber)
      finalPrice = csiResult.price
      source = 'CoolStuffInc'

      let newScryfallId = null

      // INTENTO 2: TCGPlayer (Listed Median) si CSI falla O si queremos FORZAR ID
      const needsIdUpdate = !card.scryfall_id || String(card.scryfall_id).startsWith('riftbound-')
      
      if (finalPrice === 0 || needsIdUpdate) {
          if (finalPrice === 0) console.log('     ℹ️ CSI sin precio usable, usando fallback TCGPlayer...')
          else console.log('     ℹ️ Buscando ID en TCGPlayer para actualizar...')
          
          await humanDelay()
          const tcgResult = await scrapeTCG(page, card.name, isFoil, expectedSetName, expectedCollectorNumber)
          
          // Solo usamos el precio si CSI falló (finalPrice era 0)
          if (finalPrice === 0) {
            finalPrice = tcgResult.price
            source = 'TCGPlayer'
          }
          if (tcgResult.tcgId) newScryfallId = tcgResult.tcgId
      }

      // PROCESAR RESULTADO
      const priceChanged = finalPrice > 0 && Math.abs(finalPrice - Number(card.price_usd || 0)) > 0.01
      const idChanged = newScryfallId && newScryfallId !== card.scryfall_id

      if (finalPrice === 0) {
        zeroPriceLog.push({
          name: card.name,
          set: card.set_name,
          finish: card.finish,
          source: source || 'None'
        })
      }

      if (priceChanged || idChanged) {
          // Si solo cambió el ID pero el precio es 0 (y no hay precio nuevo válido),
          // intentamos preservar el precio anterior si era válido.
          if (finalPrice === 0 && Number(card.price_usd) > 0) {
            finalPrice = Number(card.price_usd)
          }
          
          // APLICAR PRECIO MÍNIMO DINÁMICO
          if (finalPrice > 0) {
              const minP = getMinPrice(card.rarity, isFoil)
              finalPrice = Math.max(minP, finalPrice)
          }

          if (DRY_RUN) {
            const idMsg = idChanged ? ` [ID Nuevo: ${newScryfallId}]` : ''
            const priceMsg = priceChanged ? `$${oldPrice} -> $${finalPrice}` : `Precio igual ($${finalPrice})`
            console.log(`   🧪 SIMULADO: ${priceMsg} (Fuente: ${source})${idMsg}`)
          } else {
            const updatePayload = {}
            if (priceChanged && finalPrice > 0) updatePayload.price_usd = finalPrice
            if (idChanged) updatePayload.scryfall_id = newScryfallId

            if (Object.keys(updatePayload).length > 0) {
                const { data: updatedRow, error: updateError } = await supabase
                  .from('products')
                  .update(updatePayload)
                  .eq('id', card.id)
                  .select('id, name, finish, price_usd, scryfall_id')
                  .single()
                
                if (updateError) {
                  // Manejo de Error Duplicate Key (unique_product_variant)
                  if (updateError.code === '23505' || updateError.message.includes('unique_product_variant')) {
                      console.log(`   ⚠️ ID Duplicado detectado (${newScryfallId}). Intentando resolver...`)
                      
                      // Si es duplicado, significa que YA existe otra carta con ese scryfall_id.
                      // Probablemente sea la versión Non-Foil vs Foil compartiendo ID (comportamiento de TCGPlayer a veces).
                      // O bien, estamos asignando el ID incorrecto.
                      
                      // Estrategia: Si el ID es correcto, agregamos un sufijo '-f' para foil o '-n' para normal
                      // para satisfacer la constraint de unicidad de tu BD.
                      const suffix = isFoil ? '-f' : '-n'
                      // Verificamos si ya tiene sufijo
                      let patchedId = String(newScryfallId)
                      if (!patchedId.endsWith('-f') && !patchedId.endsWith('-n')) {
                          patchedId = `${patchedId}${suffix}`
                      } else {
                          // Si ya tiene sufijo y aun asi choca, intentamos con un random corto
                          patchedId = `${patchedId}-${Math.floor(Math.random()*100)}`
                      }
                      
                      console.log(`   🔄 Reintentando con ID parcheado: ${patchedId}`)
                      const { error: retryError } = await supabase
                        .from('products')
                        .update({ ...updatePayload, scryfall_id: patchedId })
                        .eq('id', card.id)
                        .select('id, name, finish, price_usd, scryfall_id')
                        .single()
                      
                      if (retryError) {
                          console.log(`   ❌ Error final actualizando BD: ${retryError.message}`)
                      } else {
                          // Aseguramos que finalPrice es un número antes de toFixed
                          const safePrice = Number(finalPrice) || 0
                          console.log(`   ✅ ACTUALIZADO (Con Sufijo): $${oldPrice} -> $${safePrice.toFixed(2)} [ID: ${patchedId}]`)
                      }
                  } else {
                      console.log(`   ❌ Error actualizando BD: ${updateError.message}`)
                  }
                  await humanDelay(500, 900)
                  continue
                }

                const newP = Number(updatedRow?.price_usd || finalPrice || 0).toFixed(2)
                const extraInfo = idChanged ? ` [ID: ${updatedRow?.scryfall_id}]` : ''
                const pMsg = priceChanged ? `$${oldPrice} -> $${newP}` : `Precio mantenido`
                console.log(`   ✅ ACTUALIZADO: ${pMsg} (Fuente: ${source})${extraInfo}`)
            }
          }
          
          changeLog.push({
              name: card.name,
              set_name: card.set_name,
              collector_number: card.collector_number,
              finish: card.finish || 'Normal',
              oldPrice: oldPrice,
              newPrice: finalPrice > 0 ? finalPrice.toFixed(2) : oldPrice,
              source: source,
              newId: idChanged ? newScryfallId : null
          })
          if (!DRY_RUN) updatedCount++
      } else {
          console.log(`   ⚡ Sin cambios (Precio: $${finalPrice}, ID: ${card.scryfall_id})`)
      }

      await humanDelay(1500, 3000)
  }

  await browser.close()

  console.log('\n=================================================')
  console.log(`🎉 PROCESO FINALIZADO. Cartas actualizadas: ${updatedCount} de ${allCards.length}`)
  
  if (changeLog.length > 0) {
      console.log('\n📝 REPORTE DE CAMBIOS:');
      console.log(String('CARTA').padEnd(35) + ' | ' + String('SET').padEnd(18) + ' | ' + String('ACABADO').padEnd(10) + ' | ' + String('PRECIO ANTERIOR').padEnd(15) + ' | ' + String('NUEVO PRECIO').padEnd(12) + ' | ' + String('TCG ID').padEnd(10) + ' | ' + 'TIENDA');
      console.log('-'.repeat(120));
      
      changeLog.forEach(log => {
          const nameTrim = log.name.length > 33 ? log.name.substring(0, 30) + '...' : log.name;
          const setRaw = String(log.set_name || '').trim()
          const cnRaw = String(log.collector_number || '').trim()
          const setLabel = setRaw ? `${setRaw}${cnRaw ? ` #${cnRaw}` : ''}` : ''
          const setTrim = setLabel.length > 16 ? setLabel.substring(0, 13) + '...' : setLabel
          console.log(
              String(nameTrim).padEnd(35) + ' | ' + 
              String(setTrim).padEnd(18) + ' | ' +
              String(log.finish).padEnd(10) + ' | ' + 
              String(`$${log.oldPrice}`).padEnd(15) + ' | ' + 
              String(`$${log.newPrice}`).padEnd(12) + ' | ' + 
              String(log.newId || '-').padEnd(10) + ' | ' +
              log.source
          );
      });
  }
  if (zeroPriceLog.length > 0) {
      console.log('\n⚠️ REPORTE DE CARTAS SIN PRECIO (0):');
      console.log(String('CARTA').padEnd(35) + ' | ' + String('SET').padEnd(18) + ' | ' + String('ACABADO').padEnd(10) + ' | ' + 'FUENTE');
      console.log('-'.repeat(100));
      zeroPriceLog.forEach(log => {
          const nameTrim = log.name.length > 33 ? log.name.substring(0, 30) + '...' : log.name;
          const setTrim = log.set.length > 16 ? log.set.substring(0, 13) + '...' : log.set
          console.log(
              String(nameTrim).padEnd(35) + ' | ' + 
              String(setTrim).padEnd(18) + ' | ' +
              String(log.finish).padEnd(10) + ' | ' + 
              log.source
          );
      });
  }

  console.log('=================================================\n')
}

main().catch(console.error)
