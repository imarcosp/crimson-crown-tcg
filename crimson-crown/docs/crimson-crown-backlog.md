# Crimson Crown — backlog y gates de liberación

Actualizado: 2026-08-30. Este documento cubre únicamente Crimson Crown. SaaS y Mercado Pago quedan fuera de alcance por decisión del propietario.

## Estado del entorno local

- La réplica local usa Supabase en loopback y datos públicos sanitizados. Los dumps crudos permanecen fuera del worktree.
- Existe una cuenta admin sintética local y un usuario estándar sintético para pruebas de autorización.
- `origin/main` está en `b573b52`. Incluye runtime/multi-inventario, mutaciones administrativas, el hardening P0 completo, la reconciliación productiva y la resincronización del carrito después de autenticarse.
- Supabase productivo registra 16 migraciones de release. El último preflight productivo confirmó 63 órdenes, 81 perfiles, 1.954 productos, dos movimientos de inventario, nueve períodos históricos de comisiones y cero violaciones de invariantes.
- Storage productivo conserva los 66 objetos observados: 35 productos, cinco banners y 26 comprobantes. `payment_proofs` es privado, los tres buckets objetivo tienen límites de 5 MiB/MIME y `storage.objects` no expone políticas de escritura del navegador.
- El servidor local se mantiene disponible en `http://127.0.0.1:3000` / `http://localhost:3000`.
- Vercel productivo es `prj_wHaQDSKDKuTP4rPoS1SeCFulls8g` (`crimson-crown-tcg`), raíz `crimson-crown`. El deployment Git de `b573b52` es `dpl_urpp3fEwBbSmiDVefbLTEuSRZyKR`, está `READY` y posee el alias `https://www.crimsoncrownimports.com`.
- Crimson tiene staging exclusivo `ssyeqgtdohwkcucedpwx`; no contiene filas ni objetos copiados de producción. El ensayo P0 y su ledger controlado están documentados en `docs/runbooks/crimson-staging.md`.
- Los guards bloquean Preview/Development contra Supabase productivo y rechazan las referencias conocidas de El Perchero/Che Maracucho. El Perchero permanece estrictamente de solo lectura para el futuro port del Deckbuilder.

## Preflight remoto histórico — 2026-08-29

Este bloque conserva el diagnóstico que originó el P0. Sus bloqueos fueron reconciliados y liberados el 30 de agosto; el estado vigente está en las secciones anteriores y en `docs/evidence/crimson-production-reconciliation-2026-08-30.md`.

- Identidad verificada: Supabase `Crimson Crown` (`djfqozfaqkqdoqeoqbzt`), estado `ACTIVE_HEALTHY`, PostgreSQL 17. El proyecto ajeno de El Perchero no fue consultado más allá de resolver su identidad y no recibió ninguna mutación.
- `migration list --linked` encontró cinco versiones remotas cuyos timestamps no existen en el repositorio y 22 versiones locales no registradas remotamente. Con migraciones habilitadas temporalmente sólo para diagnóstico, `db push --linked --dry-run` falló cerrado con `LegacyDbPushMissingLocalError`; no se ejecutó `migration repair`, `db pull` ni `db push` real.
- El primer dry-run devolvía incorrectamente “up to date” porque `[db.migrations].enabled = false`; esa configuración sigue restaurada y es necesaria para la réplica local basada en dump. Cualquier futuro gate debe usar una configuración de release aislada, nunca interpretar ese skip como evidencia.
- Advisors de seguridad: 67 hallazgos (1 error, 65 warnings, 1 info). El error es `public.admin_users` como vista `SECURITY DEFINER`; además conserva `SELECT` para `anon` y `authenticated`. Hay 24 funciones sin `search_path` fijo y grants heredados sobre funciones `SECURITY DEFINER` que requieren clasificación individual.
- Advisors de rendimiento: 242 hallazgos (212 warnings, 30 info), principalmente 159 políticas permisivas duplicadas y 52 evaluaciones RLS por fila. Se abordarán por dominios, no mediante una migración monolítica.
- Storage productivo contiene tres buckets públicos (`banners`, `products`, `payment_proofs`) y 66 objetos. `products` conserva políticas heredadas con rol `public` para insertar/actualizar/eliminar, y `payment_proofs` permite lectura pública. Antes de volver privado `payment_proofs` se necesita una transición compatible a rutas privadas y URLs firmadas para no romper comprobantes existentes.

## Estado liberado en producción

- Separación de configuración local: evita que SSR exponga dominio, email, WhatsApp o datos bancarios productivos.
- Guard de desarrollo: los clientes Supabase rechazan URLs productivas cuando `NODE_ENV=development`, incluso si `.env.local` contiene una configuración antigua.
- Allowlist de admin: la cuenta sintética solo es admin cuando Supabase apunta a loopback.
- Hidratación del tipo de cambio y carrito diferida al cliente para evitar mismatches de React.
- Migración defensiva del carrito persistido para estados heredados o inválidos.
- Migración local `20260823043637_local_security_baseline.sql`: RLS por rol admin, aislamiento de perfiles/órdenes/buylist/wishlists, grants de RPC y vista administrativa revocados para clientes.
- Migración local `20260823044210_fix_merge_duplicate_products_lint.sql`: corrección de tipos UUID en `merge_duplicate_products` y autorización admin.
- Migración local `20260823050711_local_write_surface_hardening.sql`: external prices sólo para admin/backend, historial de precios sin escritura desde navegador y callbacks de triggers sin grants públicos.
- Migración local `20260823051113_preserve_production_admin_allowlist.sql`: conserva el acceso de los dos admins productivos además del rol `admin`.
- Migración local `20260823140924_append_import_order_user_note.sql`: la nota de una orden de importación propia se agrega mediante una RPC que sólo acepta órdenes en estado `Iniciada`.
- Migración local `20260823142117_normalize_import_admin_policies.sql`: las políticas admin de importaciones usan `is_admin()` y no un chequeo duplicado de `profiles.role`.
- `place_order_atomic`: checkout transaccional con locks de productos/perfil, precios resueltos en base, créditos y orden/items en una única transacción. El efecto compatible está reconciliado en producción; el timestamp legacy permanece clasificado y no se reaplica.
- Migración local `20260823183638_create_release_expired_orders_atomic.sql`: liberación idempotente de órdenes vencidas con locks de orden/producto; el cron ya no restaura stock con escrituras directas.
- Baseline de compatibilidad `20260823043500`: sus efectos necesarios están probados/reconciliados en producción; el archivo sigue siendo parte del espejo local y no una migración que deba reaplicarse remotamente.
- Migración aditiva `20260829021742_admin_product_mutations.sql`: creación/reposición, edición y eliminación administrativa de productos mediante RPCs autorizadas, atómicas, idempotentes y auditadas; aplicada en staging y producción dentro del lote P0.
- RPCs acotados para editar datos propios (`update_profile_details`, `submit_order_payment_proof`), descuento de stock atómico sólo server-side y créditos sin autoacreditación/saldo negativo.
- `ProductForm`, eliminación individual/masiva y CSV ya no escriben `products` desde el navegador: usan Server Actions con sesión admin y vuelven a validar autorización dentro de PostgreSQL.
- CSV conserva resultados parciales, procesa enriquecimiento en grupos de cinco, rechaza cantidades negativas y usa claves estables por ejecución para no duplicar stock.
- El cliente Resend se inicializa sólo al enviar un correo; compilar o cargar Server Actions en el entorno local seguro ya no exige una clave externa.
- Wishlist específica: ya no intenta crear productos desde el navegador; si la variante no está catalogada, muestra una salida explícita y conserva la alerta por nombre como alternativa.
- `/api/dolar` lee con la clave pública y persiste el tipo de cambio sólo con service role; `/api/fix-images` exige sesión admin y `/api/cron/release-stock` falla cerrado fuera de loopback si falta `CRON_SECRET`.
- Storage local preparado con buckets sintéticos `payment_proofs`, `products` y `banners`; `scripts/local-db/prepare-storage-fixtures.ps1`, `storage-fixtures.sql` y `storage-matrix.mjs` son sólo de pruebas locales y no deben entrar al push de producción sin auditar las políticas remotas.
- Matriz automatizada `npm run test:local-security`: anon no ve tablas privadas; usuario estándar sólo ve sus recursos, carrito, guardados, órdenes/importaciones/buylists propios y no puede mutar productos, créditos, precios ni tablas administrativas; admin conserva acceso operativo; `supabase db lint` sin errores.
- Gate estricto de TypeScript habilitado: `npm run typecheck` (`tsc --noEmit`) pasa sin errores y Next.js ya no usa `ignoreBuildErrors`; el build local valida tipos antes de generar artefactos.
- Suite local completa verificada en este checkpoint: 57 tests de entorno, siete contratos del catálogo privilegiado, matrices de productos/seguridad/finanzas/checkout/liberación/multi-inventario/Storage, build de producción, E2E 21/21 en loopback y release 136/136 con un skip de symlink no disponible en Windows.
- Pruebas de seguridad local integradas al script `test:environment-safety`.
- Advertencia de `next/image` del logo corregida.
- Host local alternativo normalizado en desarrollo a `127.0.0.1` mediante un redirect de navegador, con prueba E2E de regresión; esto evita separar cookies de Supabase entre `localhost` y `127.0.0.1`.

## P0 — completado y liberado

1. **Historial de migraciones reconciliado.** El manifest clasifica la historia legacy, el dry-run enlazado prueba cero pendientes y la evidencia productiva registra las 16 versiones autorizadas sin `migration repair` destructivo.
2. **Proyectos aislados.** Los guards atan cada runtime a Crimson local/staging/producción y rechazan referencias ajenas antes de construir un cliente Supabase.
3. **Storage endurecido.** El frontend usa tickets/rutas canónicas y URLs firmadas; producción conserva sus objetos, hace privado `payment_proofs` y elimina políticas browser heredadas.
4. **Superficies privilegiadas cerradas.** `admin_users`, funciones `SECURITY DEFINER`, grants, `search_path` y autorización efectiva están inventariados, migrados y verificados con matrices negativas.
5. **RLS y Data API verificados.** El ensayo en staging exclusivo y la promoción productiva completaron las políticas compatibles sin alterar los agregados críticos.
6. **Flujos financieros atómicos.** Checkout, stock, créditos, liberación de órdenes, importaciones y pagos de comisiones tienen contratos transaccionales e idempotentes. Mercado Pago permanece fuera de alcance.
7. **Release observado.** La evidencia de reconciliación confirma Vercel `READY`, smoke público, 16 migraciones, 66 objetos de Storage y ausencia de cambios en órdenes, perfiles, productos e inventario fuera de las mutaciones explícitamente autorizadas.

## P1 — estabilización funcional

- E2E de Pedido completado: `/hang` abre WhatsApp, el modal "Pedido a Japón" calcula el total y `/api/search` devuelve precios.
- E2E autenticado completado con fixtures sintéticos locales: la cuenta estándar ve una compra con su producto, abre el detalle de una importación y expande el detalle de una solicitud de buylist; los fixtures se limpian al finalizar.
- Pruebas de detalle de órdenes, importaciones y buylists completadas con fixtures sintéticos locales.
- Auditoría inicial de formularios administrativos completada: el usuario estándar es redirigido fuera del panel y el admin local puede cargar Inventario, Pedidos, Importaciones, Buylists y Configuración Maestra sin escrituras de prueba.
- Warning de múltiples clientes GoTrue resuelto en este lote: `CsvUploader` e Inventario usan el singleton browser compartido; se eliminó el cliente legacy directo.
- Prueba E2E de contacto completada: un fixture REST aislado verifica que `system_settings` actualiza el Footer y el enlace de WhatsApp sin modificar la base local compartida.
- Mutaciones administrativas de productos completadas: creación/reposición concurrente exacta, edición con ajuste auditado, rechazo de borrado con historial, borrado seguro sin referencias y CSV parcial sin afectar otro inventario.
- Playwright usa el puerto configurado y un solo trabajador porque los E2E locales comparten usuarios y fixtures mutables; la suite completa pasa 21/21 sin interferencias y termina sin residuos sintéticos.
- La suscripción de autenticación del Navbar difiere las consultas de perfil fuera de `onAuthStateChange` y ya no se vuelve a crear al cambiar usuario/perfil; el ciclo usuario estándar/admin pasó 9/9 en repetición focalizada.
- `CartSync` reacciona a `INITIAL_SESSION`, `SIGNED_IN` y `SIGNED_OUT`, vuelve a bajar el carrito después del login y libera correctamente la suscripción Auth y el canal Realtime. El checkout autenticado y la suite local pasan 21/21.
- PIN cliente eliminado: el panel se abre directamente sólo después de superar sesión admin, proxy, Server Actions y RLS; el E2E demuestra acceso admin y denegación del usuario estándar.
- Registro, solicitud de recuperación, callback PKCE server-side y actualización real de contraseña pasan E2E con usuarios sintéticos locales y limpieza completa.
- Google OAuth está diseñado/documentado en `docs/runbooks/crimson-google-oauth.md`, pero permanece deshabilitado hasta recibir client ID/secret y redirect URIs exclusivos de Crimson para local/staging/producción.
- Responsive administrativo completado: navegación móvil colapsable, layout sin overflow global, tablas anchas con scroll local verificado, modal de inventarios contenido y matriz E2E en 390/768 px sobre diez rutas operativas.
- Completar los filtros de Magic con rango de precio y formato; conservar los filtros existentes de orden, color, set, finish, rareza y condición.
- Implementar accesos rápidos administrables bajo el banner: cantidad, orden, imagen/icono, etiqueta, URL y estado activo.
- Portar el Deckbuilder de Magic desde El Perchero únicamente mediante lectura y reimplementación dentro de Crimson, sin compartir credenciales, datos, procesos ni escritura de archivos.

## P2 — calidad y operación

- Reducir la deuda heredada de ESLint; TypeScript estricto ya está integrado al build y queda ESLint como lote independiente.
- Actualizar `baseline-browser-mapping` cuando se abra un lote de dependencias.
- Auth/Storage gestionados usan sólo fixtures sintéticos. El preparador Auth recrea exclusivamente el trigger productivo conocido dentro de `supabase_db_crimson-crown`; Storage usa objetos sintéticos y ninguno de los dos importa secretos, identidades u objetos productivos.
- Storage gestionado no se copia al dump local: las pruebas usan buckets/objetos sintéticos y el runbook documenta esta diferencia. El hardening remoto ya fue aplicado y debe conservarse como invariante en releases futuros.
- Los verificadores locales de PostgreSQL/Storage aceptan autenticación del stack actual y resuelven el worktree de Crimson dinámicamente, pero conservan nombres de contenedor, proyecto y puertos exactos; las matrices terminan con cero objetos o filas sintéticas residuales.
- Añadir inventario de esquema, row-counts y clasificación de datos como artefactos externos verificables.
- Documentar backups locales, restauración y recuperación sin incluir dumps dentro de Git.
- La validación estricta de TypeScript quedó resuelta en el checkpoint `cd2c63c`; mantener `npm run typecheck` como gate obligatorio de cada lote.
- ESLint sigue fuera del gate de promoción: la ejecución completa actual reporta 497 errores y 178 advertencias en la base heredada (principalmente `no-explicit-any` y reglas de efectos React). Los módulos nuevos de este lote pasan el lint focalizado sin hallazgos. La deuda global requiere lotes dedicados, no una corrección mecánica dentro de una migración de seguridad.

## Siguiente backlog recomendado

1. **Catálogo Magic.** Añadir precio y formato sin degradar los filtros/URL existentes.
2. **Accesos rápidos.** Diseñar el modelo aditivo y la administración de cantidad, orden, imagen/icono, etiqueta, URL y estado.
3. **Deckbuilder.** Reimplementar en Crimson a partir de una inspección estrictamente de solo lectura de El Perchero, sin código compartido en runtime ni acceso a sus datos.
4. **Operación y calidad.** Automatizar snapshots de esquema/row-counts, documentar backup/restauración local y abordar ESLint por grupos pequeños con pruebas de regresión.
5. **Google OAuth (bloqueo externo).** El flujo y runbook están definidos; habilitarlo sólo cuando existan client ID/secret y redirects exclusivos de Crimson para cada entorno.

## SaaS — después de todo lo anterior

- Extraer configuración por tenant, branding, dominios y roles.
- Separar facturación, límites y observabilidad.
- Crear un proyecto plantilla sin reutilizar datos ni credenciales de Crimson Crown.

## Gates antes del próximo release a producción

1. Revisión manual del lote actual y de cualquier migración SQL nueva.
2. Suite local de seguridad y tests de autorización negativos en verde.
3. Build y validación de tipos sin errores nuevos.
4. Pruebas manuales de checkout y stock en un entorno controlado, sin proveedor de pagos real.
5. Si aparece una migración nueva, promover primero el SQL compatible y después el código que lo consume; no reaplicar ni reparar las 16 migraciones productivas ya reconciliadas.
6. Si el lote toca Storage, preservar los 66 objetos observados y verificar nuevamente privacidad, MIME/tamaño, rutas firmadas y conteos antes/después.
7. Diff revisado por el propietario; recién entonces se autoriza commit/push y un despliegue separado.
