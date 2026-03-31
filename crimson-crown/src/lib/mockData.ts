export type MockProduct = {
  id: string
  name: string
  setName: string
  collectorNumber: string
  tcg: 'Magic' | 'Pokémon'
  priceUsd: number
  stock: number
  condition: 'NM' | 'PL' | 'HP' | 'DMG'
  finish: 'Foil' | 'Non-Foil' | 'Holo'
  imageUrl: string
  type: 'STOCK' | 'IMPORT'
  rarity: 'Common' | 'Uncommon' | 'Rare' | 'Mythic'
}

export const mockProducts: MockProduct[] = [
  {
    id: '1',
    name: 'Ragavan, Nimble Pilferer',
    setName: 'Modern Horizons 2',
    collectorNumber: '227',
    tcg: 'Magic',
    priceUsd: 75.0,
    stock: 2,
    condition: 'NM',
    finish: 'Non-Foil',
    imageUrl: 'https://cards.scryfall.io/large/front/a/9/a9738cda-adb1-47fb-9f4c-ecd930228c4d.jpg',
    type: 'STOCK',
    rarity: 'Mythic',
  },
  {
    id: '2',
    name: 'Sheoldred, the Apocalypse',
    setName: 'Dominaria United',
    collectorNumber: '107',
    tcg: 'Magic',
    priceUsd: 85.0,
    stock: 4,
    condition: 'NM',
    finish: 'Non-Foil',
    imageUrl: 'https://cards.scryfall.io/large/front/d/6/d67be074-cdd4-41d9-ac89-0a0456c4e4b2.jpg',
    type: 'STOCK',
    rarity: 'Mythic',
  },
  {
    id: '3',
    name: 'Charizard',
    setName: 'Base Set',
    collectorNumber: '4/102',
    tcg: 'Pokémon',
    priceUsd: 0,
    stock: 0,
    condition: 'NM',
    finish: 'Holo',
    imageUrl: 'https://images.pokemontcg.io/base1/4_hires.png',
    type: 'IMPORT',
    rarity: 'Rare',
  },
]
