# Release seguro — filtros Magic de precio y formato

## Artefactos

- Migración: `20260830133000_add_magic_legalities_to_external_prices.sql`.
- Backfill: `node scripts/backfill-magic-legalities.mjs --plan|--apply`.
- Código consumidor: catálogo y sidebar de filtros.

La migración agrega únicamente `public.external_prices.legalities jsonb not null default '{}'`. No contiene DML y no referencia productos, inventarios, órdenes, perfiles ni movimientos.

## Evidencia local

- 101.090 filas de `external_prices` antes y después.
- 1.726 IDs Magic del inventario enriquecidos; cero faltantes en Scryfall.
- Segundo plan: cero cambios pendientes y 1.726 filas sin cambios.
- Productos/stock: 1.840 / 2.147 antes y después.
- Órdenes/perfiles/movimientos observados después: 58 / 77 / 51; el release remoto debe tomar su propio baseline inmediatamente antes de promover.

## Orden obligatorio

1. Capturar en el entorno destino los conteos de `orders`, `profiles`, `products`, suma de `products.stock`, `inventories`, `inventory_stock_movements` y `external_prices`.
2. Aplicar sólo la migración `20260830133000` con el mecanismo de migraciones de Supabase sobre el proyecto Crimson seleccionado. No usar `db reset`, `migration repair` ni replay histórico.
3. Verificar columna, constraint, grants/RLS existentes y conteos operativos idénticos.
4. Ejecutar el backfill en `--plan` con `CRIMSON_OPERATION_TARGET=staging` o `production` y credenciales del proyecto Crimson cargadas fuera de Git.
5. Revisar que `externalRows` coincida con el universo esperado, `notFound=0` y que el único cambio propuesto sea `legalities`.
6. Ejecutar `--apply`, repetir `--plan` y exigir `pendingUpdates=0`.
7. Promover el código, realizar smoke del catálogo y repetir los conteos operativos.

## Rollback

El código tolera `{}` cuando no hay filtro de formato. Ante un problema, se revierte primero el deployment; la columna puede permanecer sin afectar el runtime anterior. No eliminar la columna durante un incidente. El backfill es metadata reproducible desde Scryfall y no debe revertirse con escrituras sobre tablas operativas.
