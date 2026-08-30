# Plan — Deckbuilder Magic de Crimson

1. Definir contratos puros de formatos, búsquedas, roles y cobertura comercial.
2. Crear migración aditiva de snapshots/decks/cartas, RLS y promoción atómica; aplicar sólo en Supabase local.
3. Implementar parsers puros y sincronizador seguro EDHREC/MTGTop8 con plan por defecto y límites.
4. Crear consultas server-side que relacionen decks con el catálogo híbrido de Crimson sin service role.
5. Implementar landing, formatos, listado, detalle y acciones carrito/cotización mobile-first.
6. Agregar navegación, fixture sintético E2E y matrices negativas de RLS con limpieza.
7. Ejecutar lint DB, seguridad, tipos, build, E2E y release; clasificar la migración como forward pendiente.
8. Documentar el orden de promoción y dejar un commit aislado sin push ni producción.
