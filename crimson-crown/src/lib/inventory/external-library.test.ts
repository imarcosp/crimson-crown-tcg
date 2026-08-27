import assert from 'node:assert/strict'
import test from 'node:test'
import { externalLibraryRowToSuggestion } from './external-library.ts'

test('convierte una carta de external_prices en una sugerencia Magic con prioridad Card Kingdom', () => {
  const suggestion = externalLibraryRowToSuggestion({
    scryfall_id: 'library-ck',
    name: 'Library Card',
    set_name: 'Test Set',
    collector_number: '12',
    image_url: 'https://example.test/card.jpg',
    rarity: 'rare',
    cardkingdom_retail_normal: 5.49,
    tcgplayer_market_normal: 4.33,
  })

  assert.deepEqual({
    price: suggestion.price_usd,
    source: suggestion.pricing_source,
    tcg: suggestion.tcg,
    scryfallId: suggestion.scryfall_id,
    finish: suggestion.finish,
  }, {
    price: 5.49,
    source: 'cardkingdom',
    tcg: 'Magic',
    scryfallId: 'library-ck',
    finish: 'Non-Foil',
  })
})

test('usa TCGplayer como fallback y conserva una carta aunque no tenga precio', () => {
  const fallback = externalLibraryRowToSuggestion({
    scryfall_id: 'library-tcg',
    name: 'Fallback Card',
    tcgplayer_market_normal: 2.25,
  })
  const noPrice = externalLibraryRowToSuggestion({
    scryfall_id: 'library-manual',
    name: 'Manual Card',
  })

  assert.equal(fallback.price_usd, 2.25)
  assert.equal(fallback.pricing_source, 'tcgplayer')
  assert.equal(noPrice.price_usd, 0)
  assert.equal(noPrice.pricing_source, 'unknown')
  assert.deepEqual(noPrice.finishes, ['nonfoil'])
})

test('resuelve normal y foil de forma independiente cuando sólo una fuente tiene cada precio', () => {
  const suggestion = externalLibraryRowToSuggestion({
    scryfall_id: 'library-mixed',
    name: 'Mixed Finish Card',
    cardkingdom_retail_normal: 3.75,
    cardkingdom_retail_foil: 0,
    tcgplayer_market_foil: 8.5,
  })

  assert.equal(suggestion.price_usd, 3.75)
  assert.equal(suggestion.price_usd_foil, 8.5)
  assert.equal(suggestion.pricing_source, 'cardkingdom')
  assert.deepEqual(suggestion.finishes, ['nonfoil', 'foil'])
})
