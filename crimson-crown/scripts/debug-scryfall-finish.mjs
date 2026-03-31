import 'dotenv/config'

async function main() {
    const id = '470dd3c8-07c9-42ef-aa9e-3c73b23607ff'
    console.log(`🕵️  Consultando Scryfall para ID: ${id}`)
    
    const res = await fetch(`https://api.scryfall.com/cards/${id}`)
    const card = await res.json()
    
    console.log(`Nombre: ${card.name}`)
    console.log(`Set: ${card.set_name} (${card.set})`)
    console.log(`CN: ${card.collector_number}`)
    console.log(`Finishes: ${JSON.stringify(card.finishes)}`)
    console.log(`Prices: ${JSON.stringify(card.prices, null, 2)}`)
}

main().catch(console.error)
