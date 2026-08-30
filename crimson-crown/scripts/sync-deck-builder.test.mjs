import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  collectEdhrecSnapshot,
  collectMtgtop8Snapshot,
  parseDeckBuilderSyncCli,
} from './sync-deck-builder.mjs'

const source = fs.readFileSync(new URL('./sync-deck-builder.mjs', import.meta.url), 'utf8')

test('el sincronizador queda en plan por defecto y rechaza combinaciones ambiguas', () => {
  assert.deepEqual(parseDeckBuilderSyncCli([]), {
    mode: 'plan', source: 'edhrec', format: 'commander', maxDecks: 8, maxCards: 100,
  })
  assert.equal(parseDeckBuilderSyncCli(['--apply', '--source=mtgtop8', '--format=modern', '--max-decks=2']).mode, 'apply')
  assert.throws(() => parseDeckBuilderSyncCli(['--source=edhrec', '--format=modern']), /formato/iu)
  assert.throws(() => parseDeckBuilderSyncCli(['--apply', '--max-decks=1000']), /límite/iu)
})

test('el script no enlaza rutas, credenciales ni proyectos de otros repositorios', () => {
  assert.doesNotMatch(source, /El Perchero|Che Maracucho|tszglqwrklthnzhqdffn/iu)
  assert.doesNotMatch(source, /supabase[.]co|migration repair|db push|db reset/iu)
  assert.match(source, /createOperationalSupabaseClient/iu)
})

test('recolecta un snapshot EDHREC sintético sin cliente de base de datos', async () => {
  const responses = new Map([
    ['https://json.edhrec.com/pages/commanders/week.json', { cardviews: [{ slug: 'atraxa', name: 'Atraxa', num_decks: 10 }] }],
    ['https://json.edhrec.com/pages/commanders/atraxa.json', { container: { json_dict: {
      card: { name: 'Atraxa' }, cardlists: [{ tag: 'topcards', cardviews: [{ name: 'Sol Ring' }] }],
    } } }],
  ])
  const fetchImpl = async (url) => ({ ok: true, json: async () => responses.get(url) })
  const snapshot = await collectEdhrecSnapshot({ maxDecks: 1, maxCards: 2, fetchImpl })
  assert.equal(snapshot.source, 'edhrec')
  assert.equal(snapshot.decks[0].cards.length, 2)
})

test('recolecta un snapshot MTGTop8 sintético con un deck por arquetipo', async () => {
  const responses = new Map([
    ['https://www.mtgtop8.com/format?f=MO', '<div class="hover_tr"><img src="/metas_thumbs/1.png"><a href="archetype?a=1&meta=99&f=MO">Boros</a><span class="S14">12%</span></div>'],
    ['https://www.mtgtop8.com/archetype?a=1&meta=99&f=MO', '<table><tr><input type="hidden" name="deck_ref[0]" value="456"><td><a href="/event?e=12&d=456&f=MO">Boros</a></td></tr></table>'],
    ['https://www.mtgtop8.com/event?e=12&d=456&f=MO', '<a href="dec?d=456">Export</a>'],
    ['https://www.mtgtop8.com/dec?d=456', '// NAME: Boros\n4 Guide of Souls'],
  ])
  const fetchImpl = async (url) => ({ ok: true, text: async () => responses.get(url) })
  const snapshot = await collectMtgtop8Snapshot({ format: 'modern', maxDecks: 1, fetchImpl })
  assert.equal(snapshot.decks[0].externalId, '456')
  assert.equal(snapshot.decks[0].cards[0].quantity, 4)
})
