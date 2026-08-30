# Plan de implementación — filtros Magic

1. Fijar contratos puros para normalizar formato, rango y legalidades.
2. Agregar `external_prices.legalities` mediante una migración aditiva local.
3. Enriquecer el sincronizador Scryfall y crear un backfill de legalidades con modo plan/aplicar.
4. Incorporar `priceMin`, `priceMax` y `format` al catálogo y a su sidebar conservando la URL existente.
5. Probar combinaciones, responsive, build y suites de seguridad sin producción.
6. Documentar el lote y dejar un commit aislado listo para revisión antes de cualquier promoción.
