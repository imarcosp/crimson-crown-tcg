# Crimson Crown — Deckbuilder Magic aislado

## Objetivo

Reimplementar dentro de Crimson la experiencia pública de `/deck-builder/magic`: elegir un formato, explorar decks representativos, abrir una lista, conocer cobertura de stock local y actuar sobre cada carta. El Perchero se usa exclusivamente como referencia visual y funcional de sólo lectura; no se copian datos, credenciales, procesos, enlaces de runtime ni configuración.

## Alcance funcional

- Landing de Deckbuilder y selector de formatos Magic con datos activos.
- Listado buscable de decks por formato, fuente y snapshot.
- Detalle agrupado en commander, mainboard, sideboard, companion y maybeboard.
- Cobertura local por cartas únicas y cantidades, usando sólo inventarios activos de Crimson.
- Compra de la mejor variante local mediante el carrito híbrido existente y cotización de faltantes mediante el flujo de importación existente.
- Estados vacíos explícitos cuando todavía no se sincronizó un formato.

No se importan en esta fase las funciones sociales, torneos Zenith, cuentas, usuarios o datos productivos de El Perchero. Tampoco se crea un editor persistente de mazos del usuario: el módulo de referencia es un explorador comercial de decks consolidados.

## Modelo de datos

`deck_builder_snapshots` representa una captura por fuente/formato y sólo una puede estar activa por combinación. `deck_builder_decks` contiene la identidad y métricas resumidas del deck. `deck_builder_cards` contiene nombre, identidad Scryfall opcional, rol y cantidad.

Las tres tablas son aditivas y ajenas a productos, inventarios, órdenes, perfiles y movimientos. Público y usuarios autenticados sólo leen snapshots activos y sus descendientes. Admin puede inspeccionar y mutar mediante RLS; la sincronización usa service role. Una RPC acotada promueve un snapshot en una sola transacción y retira el anterior sin borrar historia.

## Ingesta independiente

- EDHREC: ranking semanal y páginas públicas JSON de commanders; se arma un shell recomendado acotado.
- MTGTop8: página pública del formato, arquetipos, decks y export `.dec`; se limita el número de arquetipos/decks.
- El sincronizador es `--plan` por defecto. `--apply` exige un destino Crimson validado y nunca toma `.env`, Supabase ni datos de El Perchero.
- Los parsers son puros y se prueban con fixtures sintéticos; las suites no llaman proveedores externos.
- Cada ejecución escribe un snapshot `staging`, decks/cards y finalmente llama la promoción atómica. Un fallo no reemplaza el snapshot activo.

## Cobertura comercial

El servidor público relaciona primero por `scryfall_id` y luego por nombre normalizado contra `external_prices` y `products` de Crimson. Usa inventarios activos y el agrupador híbrido ya probado. No escribe stock ni reserva unidades al navegar. El carrito sigue enviando sólo el producto representativo al checkout atómico existente.

## Seguridad y release

- Migración primero, sincronización controlada después y código al final.
- La migración no contiene DML sobre tablas operativas.
- El código tolera cero snapshots y muestra un estado vacío.
- Rollback de código deja las tablas aisladas; no se borran snapshots durante incidentes.
- Antes/después se comparan productos, stock, órdenes, perfiles, inventarios y movimientos.
