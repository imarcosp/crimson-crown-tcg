import { chromium } from 'playwright'

async function probe() {
    console.log('Testing TCGCSV Access...')
    const browser = await chromium.launch({ headless: false })
    const page = await browser.newPage()
    
    const tryUrl = async (url) => {
        try {
            console.log(`\nProbando: ${url}`)
            const response = await page.goto(url, { timeout: 15000 })
            const status = response.status()
            console.log(`Status: ${status}`)
            
            const text = await page.evaluate(() => document.body.innerText)
            const isJson = text.trim().startsWith('{') || text.trim().startsWith('[')
            
            if (status === 200 && isJson) {
                console.log('✅ JSON Encontrado!', text.substring(0, 50))
                return true
            } else {
                console.log('❌ Falló. Body snippet:', text.substring(0, 50))
            }
        } catch (e) {
            console.log(`❌ Error: ${e.message}`)
        }
        return false
    }

    // Variantes de prueba
    await tryUrl('https://tcgcsv.com/categories')
    await tryUrl('https://tcgcsv.com/89/groups.json') // Intento de static
    await tryUrl('https://tcgcsv.com/api/categories') // Intento de API prefix
    
    // Si la categoría 89 es correcta, tal vez es otro nombre en la URL
    // Intentemos listar las categorías para ver si Riftbound existe y qué ID tiene.
    
    await browser.close()
}

probe()
