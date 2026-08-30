import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const sql = fs.readFileSync(
  new URL('../../supabase/migrations/20260830170000_create_home_quick_links.sql', import.meta.url),
  'utf8',
)

test('la migración de accesos rápidos es aditiva y no contiene DML operativo', () => {
  assert.match(sql, /create table if not exists public[.]home_quick_links/iu)
  assert.match(sql, /alter table public[.]home_quick_links enable row level security/iu)
  assert.match(sql, /using \(active = true\)/iu)
  assert.match(sql, /using \(public[.]is_admin\(\)\)[\s\S]*with check \(public[.]is_admin\(\)\)/iu)
  assert.doesNotMatch(sql, /^\s*(?:insert into|update\s+public[.]|delete from|truncate)\b/imu)
  assert.doesNotMatch(sql, /public[.](?:products|orders|profiles|inventories|inventory_stock_movements)/iu)
})

test('el modelo cubre cantidad dinámica, orden, visual, etiqueta, URL y estado', () => {
  for (const column of ['label', 'url', 'image_url', 'icon_key', 'display_order', 'active']) {
    assert.match(sql, new RegExp(`\\b${column}\\b`, 'u'))
  }
  assert.match(sql, /icon_key in \('sparkles',[\s\S]*'truck'\)/iu)
  assert.match(sql, /display_order between 0 and 9999/iu)
})
