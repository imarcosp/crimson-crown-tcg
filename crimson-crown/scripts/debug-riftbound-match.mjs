import 'dotenv/config'
import { createOperationalSupabaseClient as createClient } from './lib/guarded-supabase-client.mjs'
import { chromium } from 'playwright'

const API_BASE = 'https://tcgcsv.com'
const CATEGORY_ID = 89
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const normalizeString = (str) => {
    return String(str || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

async function main() {
    console.log('🕵️  DEBUG MATCHING RIFTBOUND')

    // 1. Obtener carta local
    const { data: locals } = await supabase
        .from('products')
        .select('*')
        .ilike('name', '%Miss Fortune%')
        .eq('tcg', 'Riftbound')
    
    if (!locals || locals.length === 0) {
        console.log('❌ No encontré Miss Fortune en tu base de datos local (Riftbound).')
        return
    }

    console.log(`\n📦 Encontradas ${locals.length} cartas locales:`)
    locals.forEach(p => {
        const finish = normalizeString(p.finish) === 'foil' ? 'foil' : 'normal'
        const key = `${normalizeString(p.set_name)}|${normalizeString(p.name)}|${normalizeString(p.collector_number)}|${finish}`
        console.log(`   [LOCAL] ID:${p.id}`)
        console.log(`      Set: "${p.set_name}" -> Norm: "${normalizeString(p.set_name)}"`)
        console.log(`      Name: "${p.name}" -> Norm: "${normalizeString(p.name)}"`)
        console.log(`      CN: "${p.collector_number}" -> Norm: "${normalizeString(p.collector_number)}"`)
        console.log(`      Finish: "${p.finish}" -> Norm: "${finish}"`)
        console.log(`      🔑 KEY: ${key}`)
    })

    // 2. Buscar en TCGCSV
    console.log('\n🌐 Buscando en TCGCSV...')
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()

    // Buscamos en el set "Origins" que es donde la vimos antes
    // Primero necesitamos el GroupId de Origins
    const groupsRes = await page.goto(`${API_BASE}/tcgplayer/${CATEGORY_ID}/groups`)
    const groups = await groupsRes.json()
    const originsGroup = groups.results.find(g => g.name === 'Origins')
    
    if (!originsGroup) {
        console.log('❌ No encontré el set "Origins" en TCGCSV.')
        await browser.close()
        return
    }

    const productsRes = await page.goto(`${API_BASE}/tcgplayer/${CATEGORY_ID}/${originsGroup.groupId}/products`)
    const products = await productsRes.json()
    
    const remotes = products.results.filter(p => p.name.includes('Miss Fortune'))
    
    console.log(`\n🌍 Encontradas ${remotes.length} cartas remotas en set "Origins":`)
    
    remotes.forEach(r => {
        const cn = r.extendedData.find(x => x.name === 'Number')?.value
        // TCGCSV suele tener foil y normal. Probamos ambas keys.
        ['normal', 'foil'].forEach(finish => {
            const key = `${normalizeString(originsGroup.name)}|${normalizeString(r.name)}|${normalizeString(cn)}|${finish}`
            console.log(`   [REMOTE] ID:${r.productId} (${finish})`)
            console.log(`      Set: "${originsGroup.name}"`)
            console.log(`      Name: "${r.name}"`)
            console.log(`      CN: "${cn}"`)
            console.log(`      🔑 KEY: ${key}`)
        })
    })

    await browser.close()
}

main().catch(console.error)
