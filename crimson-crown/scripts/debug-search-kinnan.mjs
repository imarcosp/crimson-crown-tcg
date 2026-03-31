import 'dotenv/config'

async function main() {
    const query = 'Kinnan'
    console.log(`🕵️  Simulando búsqueda: ${query}`)
    
    // Como estamos fuera de Next.js, no podemos llamar a /api/search directamente sin levantar el server
    // Usaremos un fetch a localhost asumiendo que el server de Next.js está corriendo
    
    try {
        const res = await fetch(`http://localhost:3000/api/search?q=${encodeURIComponent(query)}&debug=1`)
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`)
        const json = await res.json()
        
        const results = json.results || json
        
        console.log(`\n📦 Resultados Totales: ${results.length}`)
        
        const kinnans = results.filter(r => r.name.includes('Kinnan'))
        
        kinnans.forEach((k, i) => {
            console.log(`\n[${i+1}] ${k.name}`)
            console.log(`    Set: ${k.set_name} (#${k.collector_number})`)
            console.log(`    ID: ${k.id}`)
            console.log(`    Scryfall_ID: ${k.scryfall_id}`)
            console.log(`    IsImport: ${k.isImport}`)
        })
        
    } catch (e) {
        console.error('Error:', e)
    }
}

main()
