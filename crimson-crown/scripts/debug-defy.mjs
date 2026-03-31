import 'dotenv/config'
import { chromium } from 'playwright'

const API_BASE = 'https://tcgcsv.com'
const CATEGORY_ID = 89 // Riftbound

async function main() {
    console.log('🕵️  DEBUG RIFTBOUND: Defy')
    
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()

    // Buscamos en el set "Origins"
    const groupsRes = await page.goto(`${API_BASE}/tcgplayer/${CATEGORY_ID}/groups`)
    const groups = await groupsRes.json()
    const originsGroup = groups.results.find(g => g.name === 'Origins')
    
    if (!originsGroup) {
        console.log('❌ No encontré el set Origins.')
        await browser.close()
        return
    }

    const productsRes = await page.goto(`${API_BASE}/tcgplayer/${CATEGORY_ID}/${originsGroup.groupId}/products`)
    const products = await productsRes.json()
    
    const defys = products.results.filter(p => p.name === 'Defy')
    
    if (defys.length > 0) {
        const pricesRes = await page.goto(`${API_BASE}/tcgplayer/${CATEGORY_ID}/${originsGroup.groupId}/prices`)
        const prices = await pricesRes.json()

        for (const defy of defys) {
            console.log(`\n✅ ENCONTRADA: ${defy.name} (ID: ${defy.productId})`)
            const defyPrices = prices.results.filter(p => p.productId === defy.productId)
            console.log('💰 PRECIOS REPORTADOS POR TCGCSV:')
            console.log(JSON.stringify(defyPrices, null, 2))
        }
    } else {
        console.log('❌ No se encontró la carta Defy.')
    }

    await browser.close()
}

main().catch(console.error)
