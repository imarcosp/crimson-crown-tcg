# Crimson Crown — filtros Magic de precio y formato

## Alcance

Completar el catálogo Magic con rango de precio y formato sin modificar stock, productos, clientes, órdenes ni datos financieros. Los parámetros nuevos deben convivir con búsqueda, set, color, tierras básicas, acabado, rareza, condición, orden y paginación.

## Decisiones

- La URL usa `priceMin`, `priceMax` y `format`; cualquier cambio reinicia `page` y conserva el resto de la query.
- El rango se aplica al precio final del listing híbrido, después de agrupar inventarios activos. Los límites son inclusivos y sólo aceptan números finitos no negativos.
- `format` es un valor único allowlisted: Standard, Pioneer, Modern, Legacy, Vintage, Commander, Pauper o Brawl.
- Una carta coincide cuando Scryfall informa `legal` o `restricted`. Si falta metadata, el filtro falla cerrado para no prometer una legalidad desconocida.
- `external_prices.legalities` será JSONB aditivo, no nulo y vacío por defecto. El catálogo lo lee junto con los metadatos externos existentes y filtra en memoria el conjunto ya acotado al inventario activo.
- El sincronizador maestro conservará legalidades en futuras actualizaciones. Un backfill separado, seguro por defecto y limitado a IDs Magic ya presentes en inventario y `external_prices`, permitirá completar local/staging/producción sin alterar precios.

## Seguridad de liberación

- La migración no actualiza ni elimina filas existentes y no toca tablas operativas.
- El backfill sólo escribe la columna `legalities`; el modo por defecto es plan y `--apply` debe ser explícito.
- Primero se promueve la migración compatible, luego el backfill verificado y finalmente el código consumidor.
- Antes y después se comparan conteos de órdenes, perfiles, productos, inventario y movimientos; deben permanecer idénticos.

## Verificación

- Contratos unitarios para precio, allowlist y estados de legalidad.
- Prueba de migración local y backfill con datos locales.
- TypeScript, lint focalizado, build y Playwright en desktop/móvil.
- Prueba manual combinando formato, rango y los filtros ya existentes, además de navegación entre páginas y limpieza.
