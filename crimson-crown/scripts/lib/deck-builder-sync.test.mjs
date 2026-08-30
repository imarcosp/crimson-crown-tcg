import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseEdhrecCommander,
  parseEdhrecWeekly,
  parseMtgtop8ArchetypePage,
  parseMtgtop8DeckExport,
  parseMtgtop8EventDeckPage,
  parseMtgtop8FormatPage,
} from './deck-builder-sync.mjs'

test('parsea ranking y shell Commander desde fixtures EDHREC sintéticos', () => {
  const weekly = parseEdhrecWeekly({ cardviews: [{ slug: 'atraxa-praetors-voice', name: 'Atraxa, Praetors’ Voice', num_decks: 42 }] }, 5)
  assert.deepEqual(weekly, [{ slug: 'atraxa-praetors-voice', name: 'Atraxa, Praetors’ Voice', deckCount: 42 }])
  assert.equal(parseEdhrecWeekly({ container: { json_dict: { cardlists: [
    { tag: 'pastweek', cardviews: [{ slug: 'krenko-mob-boss', name: 'Krenko, Mob Boss', num_decks: 8 }] },
  ] } } }, 2)[0]?.slug, 'krenko-mob-boss')

  const deck = parseEdhrecCommander('atraxa-praetors-voice', {
    container: { json_dict: {
      card: { id: '00000000-0000-4000-8000-000000000001', name: 'Atraxa, Praetors’ Voice', url: '/commanders/atraxa-praetors-voice' },
      cardlists: [
        { tag: 'highsynergycards', cardviews: [{ id: '00000000-0000-4000-8000-000000000002', name: 'Evolution Sage' }] },
        { tag: 'topcards', cardviews: [{ id: '00000000-0000-4000-8000-000000000002', name: 'Evolution Sage' }, { name: 'Sol Ring' }] },
      ],
    } },
  }, { maxCards: 99, deckCount: 42 })

  assert.equal(deck.externalId, 'atraxa-praetors-voice')
  assert.equal(deck.cards[0].role, 'commander')
  assert.deepEqual(deck.cards.map((card) => card.name), ['Atraxa, Praetors’ Voice', 'Evolution Sage', 'Sol Ring'])
})

test('parsea arquetipos y export de deck MTGTop8 sintético', () => {
  const html = '<div class="hover_tr"><img src="/metas_thumbs/1.png"><a href="archetype?a=1&meta=99&f=MO">Boros Energy</a><span class="S14">12%</span></div>'
  assert.deepEqual(parseMtgtop8FormatPage(html), [{ id: '1', name: 'Boros Energy', metaShare: 0.12, url: 'https://www.mtgtop8.com/archetype?a=1&meta=99&f=MO' }])

  assert.deepEqual(parseMtgtop8DeckExport('// NAME: Boros Energy\n4 [MH3] Guide of Souls\nSB: 2 [MKM] Rest in Peace'), {
    name: 'Boros Energy',
    cards: [
      { name: 'Guide of Souls', quantity: 4, role: 'main' },
      { name: 'Rest in Peace', quantity: 2, role: 'sideboard' },
    ],
  })

  const archetypeHtml = '<table><tr><input type="hidden" name="deck_ref[0]" value="456"><td></td><td><a href="/event?e=12&d=456&f=MO">Boros Energy</a></td><td><a href="/event?e=12&f=MO">Modern Challenge</a></td></tr></table>'
  assert.deepEqual(parseMtgtop8ArchetypePage(archetypeHtml), [{
    deckId: '456',
    deckName: 'Boros Energy',
    eventDeckUrl: 'https://www.mtgtop8.com/event?e=12&d=456&f=MO',
  }])
  assert.equal(parseMtgtop8EventDeckPage('<a href="dec?d=456">Export</a>'), 'https://www.mtgtop8.com/dec?d=456')
})
