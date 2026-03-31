import { chromium } from 'playwright'

async function test() {
    console.log('Testing TCGCSV Access...')
    const browser = await chromium.launch({ headless: false }) // Headless false a veces ayuda con Cloudflare
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        }
    })
    const page = await context.newPage()

    try {
        console.log('Navigating...')
        const response = await page.goto('https://tcgcsv.com/89/groups', { waitUntil: 'domcontentloaded', timeout: 60000 })
        console.log(`Status: ${response.status()}`)
        
        // Wait a bit
        await page.waitForTimeout(5000)

        const content = await page.content()
        console.log('Content length:', content.length)
        if (content.includes('Just a moment')) {
            console.log('⚠️ Cloudflare Challenge detected!')
        } else {
             // Try to parse JSON
             const text = await page.evaluate(() => document.body.innerText)
             try {
                 const json = JSON.parse(text)
                 console.log('✅ JSON Parsed successfully!', json.results?.length || 0, 'items')
             } catch {
                 console.log('❌ Failed to parse JSON. Body text:', text.substring(0, 100))
             }
        }

    } catch (e) {
        console.error('Error:', e)
    } finally {
        await browser.close()
    }
}

test()
