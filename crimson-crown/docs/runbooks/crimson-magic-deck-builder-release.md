# Release — Deckbuilder Magic

## Alcance

- Migración aditiva: `20260830203000_create_deck_builder_foundation.sql`.
- Runtime: `/deck-builder`, `/deck-builder/magic`, listado por formato y detalle de deck.
- Ingesta: `scripts/sync-deck-builder.mjs`, siempre `--plan` por defecto.
- Tablas aisladas: `deck_builder_snapshots`, `deck_builder_decks` y `deck_builder_cards`.

La migración no modifica productos, inventarios, stock, órdenes, perfiles, importaciones ni movimientos. La navegación sólo lee snapshots activos. La promoción atómica es ejecutable exclusivamente por `service_role`.

## Preflight obligatorio

1. Confirmar proyecto Crimson exacto y deployment target `production`; rechazar cualquier referencia conocida de otro proyecto.
2. Capturar conteos de `products`, suma de `products.stock`, `orders`, `profiles`, `inventories` e `inventory_stock_movements`.
3. Ejecutar el gate de release y el dry-run de la proyección controlada. No usar `db reset`, `migration repair`, `--include-all` ni replay histórico.
4. Confirmar que la proyección contiene exactamente las migraciones forward revisadas y que el deckbuilder es la última versión.

## Orden de promoción

1. Aplicar primero la migración mediante la proyección controlada de Crimson.
2. Verificar tablas, índices, RLS, grants y que los seis conteos operativos permanezcan idénticos. Las tablas nuevas deben nacer vacías.
3. Desplegar el código. Con cero snapshots, las rutas deben responder 200 y mostrar estados vacíos explícitos.
4. Ejecutar una sincronización `--plan` acotada por fuente/formato y revisar número de decks/cartas, sin escrituras.
5. Ejecutar `--apply` sólo después de validar el plan y el target. Cada ejecución crea un snapshot `staging`; sólo se hace público al final mediante `promote_deck_builder_snapshot`.
6. Hacer smoke público de formatos, búsqueda, detalle, cobertura, carrito y cotización. No completar checkout ni crear una orden real.
7. Repetir los conteos operativos. Las únicas diferencias autorizadas son filas en las tres tablas del deckbuilder.

## Operación

- Commander: `node scripts/sync-deck-builder.mjs --plan --source=edhrec --format=commander --max-decks=8 --max-cards=100`.
- Construido: `node scripts/sync-deck-builder.mjs --plan --source=mtgtop8 --format=modern --max-decks=8`.
- Sustituir `--plan` por `--apply` únicamente con credenciales Crimson y `CRIMSON_OPERATION_TARGET` explícito.
- Un fallo durante la escritura deja el snapshot como `failed` y nunca reemplaza el snapshot activo.

## Rollback

Revertir primero el deployment. Las tablas y snapshots pueden permanecer: son aislados y el runtime anterior no los consume. No borrar tablas ni snapshots durante un incidente. Si una fuente entrega datos defectuosos, detener nuevas sincronizaciones y conservar el último snapshot activo hasta preparar uno corregido.
