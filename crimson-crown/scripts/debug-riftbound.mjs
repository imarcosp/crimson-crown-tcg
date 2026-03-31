import 'dotenv/config'
import { chromium } from 'playwright'

const API_BASE = 'https://tcgcsv.com'
const CATEGORY_ID = 89 // Riftbound

async function main() {
    console.log('🕵️  DEBUG RIFTBOUND: Miss Fortune')
    
    const browser = await chromium.launch({ headless: false })
    const page = await browser.newPage()

    // 1. Obtener Grupos
    const groupsRes = await page.goto(`${API_BASE}/tcgplayer/${CATEGORY_ID}/groups`)
    const groups = await groupsRes.json()
    
    // Buscar grupo que contenga la carta o iterar todos
    // Asumo que está en el set base o promos
    
    for (const group of groups.results) {
        console.log(`📂 Revisando set: ${group.name} (${group.groupId})...`)
        
        const productsRes = await page.goto(`${API_BASE}/tcgplayer/${CATEGORY_ID}/${group.groupId}/products`)
        const products = await productsRes.json()
        
        const mfs = products.results.filter(p => p.name.includes('Miss Fortune'))
        
        if (mfs.length > 0) {
            // Ver precios del grupo
            const pricesRes = await page.goto(`${API_BASE}/tcgplayer/${CATEGORY_ID}/${group.groupId}/prices`)
            const prices = await pricesRes.json()

            for (const mf of mfs) {
                console.log(`\n✅ ENCONTRADA: ${mf.name} (ID: ${mf.productId})`)
                const mfPrices = prices.results.filter(p => p.productId === mf.productId)
                console.log('💰 PRECIOS REPORTADOS:')
                console.log(JSON.stringify(mfPrices, null, 2))
            }
        }
    }

    await browser.close()
}

main().catch(console.error)
