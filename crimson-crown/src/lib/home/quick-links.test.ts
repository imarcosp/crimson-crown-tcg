import assert from 'node:assert/strict'
import test from 'node:test'

import {
  QUICK_LINK_ICON_OPTIONS,
  normalizeQuickLinkInput,
  normalizeQuickLinkUrl,
} from './quick-links.ts'

test('normaliza un acceso rápido completo y mantiene una allowlist de iconos única', () => {
  assert.equal(new Set(QUICK_LINK_ICON_OPTIONS.map((option) => option.value)).size, QUICK_LINK_ICON_OPTIONS.length)
  assert.deepEqual(normalizeQuickLinkInput({
    label: '  Ver Magic  ',
    url: ' /catalog?tcg=Magic ',
    imageUrl: ' https://cdn.example.test/magic.webp ',
    iconKey: ' crown ',
    displayOrder: 12,
    active: false,
  }), {
    label: 'Ver Magic',
    url: '/catalog?tcg=Magic',
    imageUrl: 'https://cdn.example.test/magic.webp',
    iconKey: 'crown',
    displayOrder: 12,
    active: false,
  })
})

test('usa un icono seguro por defecto y normaliza campos opcionales', () => {
  assert.deepEqual(normalizeQuickLinkInput({
    label: 'Catálogo',
    url: '/catalog',
    imageUrl: '',
    iconKey: 'desconocido',
    displayOrder: '3',
    active: 'false',
  }), {
    label: 'Catálogo',
    url: '/catalog',
    imageUrl: null,
    iconKey: 'sparkles',
    displayOrder: 3,
    active: false,
  })
})

test('acepta destinos internos, HTTPS y HTTP sólo en loopback', () => {
  assert.equal(normalizeQuickLinkUrl('/sell?mode=cards'), '/sell?mode=cards')
  assert.equal(normalizeQuickLinkUrl('https://example.com/path'), 'https://example.com/path')
  assert.equal(normalizeQuickLinkUrl('http://127.0.0.1:54621/storage/v1/object/public/banners/site/a.webp'), 'http://127.0.0.1:54621/storage/v1/object/public/banners/site/a.webp')
  assert.equal(normalizeQuickLinkUrl('http://localhost:54621/example'), 'http://localhost:54621/example')
})

for (const unsafeUrl of [
  'javascript:alert(1)',
  '//evil.example',
  'catalog',
  'http://example.com/insecure',
  'https://user:password@example.com/private',
]) {
  test(`rechaza URL insegura: ${unsafeUrl}`, () => {
    assert.throws(() => normalizeQuickLinkUrl(unsafeUrl), /URL inválida/u)
  })
}

test('rechaza etiquetas, órdenes y entradas malformadas', () => {
  assert.throws(() => normalizeQuickLinkInput({ label: '', url: '/catalog' }), /etiqueta/iu)
  assert.throws(() => normalizeQuickLinkInput({ label: 'x'.repeat(81), url: '/catalog' }), /etiqueta/iu)
  assert.throws(() => normalizeQuickLinkInput({ label: 'Catálogo', url: '/catalog', displayOrder: -1 }), /orden/iu)
  assert.throws(() => normalizeQuickLinkInput(null), /acceso rápido/iu)
})
