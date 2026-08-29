# Crimson Crown — backlog y gates de liberación

Actualizado: 2026-08-29. Este documento cubre únicamente Crimson Crown. SaaS y Mercado Pago quedan fuera de alcance por decisión del propietario.

## Estado del entorno local

- La réplica local usa Supabase en loopback y datos públicos sanitizados. Los dumps crudos permanecen fuera del worktree.
- Existe una cuenta admin sintética local y un usuario estándar sintético para pruebas de autorización.
- La primera liberación de runtime/multi-inventario ya está en `origin/main` (`a2e80ec`). Supabase productivo registra cinco migraciones remotas aplicadas el 26-27 de agosto: runtime productivo, revocación anónima de `is_admin`, sistema multi-inventario, funciones runtime multi-inventario e índice de búsqueda de precios externos.
- El lote posterior de mutaciones administrativas de productos quedó integrado localmente en `codex/crimson-crown-safety-foundation` (`22c3ace`) y todavía no fue enviado al remoto. El trabajo restante continúa aislado en `codex/crimson-remaining-backlog`; durante el preflight del 29 de agosto no se realizó ninguna escritura remota.
- El servidor local se mantiene disponible en `http://127.0.0.1:3000` / `http://localhost:3000`.
- Preflight Vercel read-only: el proyecto exacto es `prj_wHaQDSKDKuTP4rPoS1SeCFulls8g` (`crimson-crown-tcg`), raíz `crimson-crown`, con producción en `https://www.crimsoncrownimports.com`; el deployment productivo observado es `dpl_AvPpKMKMhJdBgFY48UjJyDxZs7mu`, commit de `main` `ab2c980c644fa36db07aa1972c60133213be4a7e`.
- Vercel actualmente comparte `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` entre Production, Preview y Development, sin un proyecto staging separado. El proxy ahora bloquea Preview/Development si apuntan al Supabase productivo; no se deben probar esos previews hasta configurar un Supabase no productivo.
- El archivo local ignorado `.env.staging` de este checkout apunta a un proyecto inactivo llamado **El Perchero - Staging** (`jzkxvgntwompkntimrao`). Es una referencia ajena y queda terminantemente fuera de uso; Crimson debe bloquear ese identificador y disponer de su propio staging antes de habilitar Preview/Development.

## Preflight remoto de solo lectura — 2026-08-29

- Identidad verificada: Supabase `Crimson Crown` (`djfqozfaqkqdoqeoqbzt`), estado `ACTIVE_HEALTHY`, PostgreSQL 17. El proyecto ajeno de El Perchero no fue consultado más allá de resolver su identidad y no recibió ninguna mutación.
- `migration list --linked` encontró cinco versiones remotas cuyos timestamps no existen en el repositorio y 22 versiones locales no registradas remotamente. Con migraciones habilitadas temporalmente sólo para diagnóstico, `db push --linked --dry-run` falló cerrado con `LegacyDbPushMissingLocalError`; no se ejecutó `migration repair`, `db pull` ni `db push` real.
- El primer dry-run devolvía incorrectamente “up to date” porque `[db.migrations].enabled = false`; esa configuración sigue restaurada y es necesaria para la réplica local basada en dump. Cualquier futuro gate debe usar una configuración de release aislada, nunca interpretar ese skip como evidencia.
- Advisors de seguridad: 67 hallazgos (1 error, 65 warnings, 1 info). El error es `public.admin_users` como vista `SECURITY DEFINER`; además conserva `SELECT` para `anon` y `authenticated`. Hay 24 funciones sin `search_path` fijo y grants heredados sobre funciones `SECURITY DEFINER` que requieren clasificación individual.
- Advisors de rendimiento: 242 hallazgos (212 warnings, 30 info), principalmente 159 políticas permisivas duplicadas y 52 evaluaciones RLS por fila. Se abordarán por dominios, no mediante una migración monolítica.
- Storage productivo contiene tres buckets públicos (`banners`, `products`, `payment_proofs`) y 66 objetos. `products` conserva políticas heredadas con rol `public` para insertar/actualizar/eliminar, y `payment_proofs` permite lectura pública. Antes de volver privado `payment_proofs` se necesita una transición compatible a rutas privadas y URLs firmadas para no romper comprobantes existentes.

## Lote actual — listo para revisión manual

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
- Migración local `20260823173257_create_place_order_atomic.sql`: checkout transaccional con locks de productos/perfil, precios resueltos en base, créditos y orden/items en una única transacción; aplicada y registrada sólo en Supabase local.
- Migración local `20260823183638_create_release_expired_orders_atomic.sql`: liberación idempotente de órdenes vencidas con locks de orden/producto; el cron ya no restaura stock con escrituras directas.
- Migración local `20260823043500_production_compatibility_baseline.sql`: compatibilidad previa para `is_admin()`, `decrement_stock(integer, uuid)` y `restore_stock(uuid)`; aplicada y registrada únicamente en Supabase local, sin grants administrativos para `anon`.
- Migración local aditiva `20260829021742_admin_product_mutations.sql`: creación/reposición, edición y eliminación administrativa de productos mediante RPCs autorizadas, atómicas, idempotentes y auditadas; aplicada y registrada únicamente en Supabase local.
- RPCs acotados para editar datos propios (`update_profile_details`, `submit_order_payment_proof`), descuento de stock atómico sólo server-side y créditos sin autoacreditación/saldo negativo.
- `ProductForm`, eliminación individual/masiva y CSV ya no escriben `products` desde el navegador: usan Server Actions con sesión admin y vuelven a validar autorización dentro de PostgreSQL.
- CSV conserva resultados parciales, procesa enriquecimiento en grupos de cinco, rechaza cantidades negativas y usa claves estables por ejecución para no duplicar stock.
- El cliente Resend se inicializa sólo al enviar un correo; compilar o cargar Server Actions en el entorno local seguro ya no exige una clave externa.
- Wishlist específica: ya no intenta crear productos desde el navegador; si la variante no está catalogada, muestra una salida explícita y conserva la alerta por nombre como alternativa.
- `/api/dolar` lee con la clave pública y persiste el tipo de cambio sólo con service role; `/api/fix-images` exige sesión admin y `/api/cron/release-stock` falla cerrado fuera de loopback si falta `CRON_SECRET`.
- Storage local preparado con buckets sintéticos `payment_proofs`, `products` y `banners`; `scripts/local-db/prepare-storage-fixtures.ps1`, `storage-fixtures.sql` y `storage-matrix.mjs` son sólo de pruebas locales y no deben entrar al push de producción sin auditar las políticas remotas.
- Matriz automatizada `npm run test:local-security`: anon no ve tablas privadas; usuario estándar sólo ve sus recursos, carrito, guardados, órdenes/importaciones/buylists propios y no puede mutar productos, créditos, precios ni tablas administrativas; admin conserva acceso operativo; `supabase db lint` sin errores.
- Gate estricto de TypeScript habilitado: `npm run typecheck` (`tsc --noEmit`) pasa sin errores y Next.js ya no usa `ignoreBuildErrors`; el build local valida tipos antes de generar artefactos.
- Suite local completa verificada en este checkpoint: 43 tests de entorno, 13 tests unitarios focalizados, matrices de productos/seguridad/finanzas/checkout/liberación/multi-inventario, lint SQL sin errores, build de producción y E2E 16/16 en loopback.
- Pruebas de seguridad local integradas al script `test:environment-safety`.
- Advertencia de `next/image` del logo corregida.
- Host local alternativo normalizado en desarrollo a `127.0.0.1` mediante un redirect de navegador, con prueba E2E de regresión; esto evita separar cookies de Supabase entre `localhost` y `127.0.0.1`.

## P0 — bloquear cualquier promoción a producción

1. **Reconciliación del historial de migraciones.** El dry-run real está bloqueado por cinco versiones remotas sin archivo local y 22 versiones locales sin historia remota. Preparar un mapeo verificable de equivalencias; no ejecutar la sugerencia automática de `migration repair --status reverted` porque podría habilitar reaplicaciones destructivas.
2. **Aislamiento entre proyectos.** Bloquear explícitamente la referencia `jzkxvgntwompkntimrao` y cualquier identificador conocido de El Perchero/Che Maracucho en los guards de Crimson. No reutilizar `.env.staging`.
3. **Storage productivo.** Cerrar escrituras públicas en `products`, limitar tamaño/MIME y diseñar la transición de `payment_proofs` a privado con rutas por usuario/orden y URLs firmadas. Mantener compatibilidad con los objetos ya existentes hasta completar el cambio de frontend.
4. **Vista y funciones privilegiadas.** Revocar la exposición de `public.admin_users`, convertirla a `security_invoker` o retirarla, y clasificar los grants de cada función `SECURITY DEFINER` antes de una migración aditiva.
5. **RLS y autorización.** Lote local aplicado y verificado. Antes de producción falta revisar el diff SQL contra el esquema remoto y validar las mismas políticas en un entorno staging exclusivo de Crimson.
6. **Pruebas de autorización negativas.** La matriz cubre tablas administrativas, carrito/guardados, órdenes, items, importaciones, buylists, wishlist, notas, Storage y las escrituras públicas intencionales (`feedback`, `search_logs`, `analytics_visits`) con limpieza de fixtures.
7. **Funciones administrativas.** La frontera de mutaciones de productos quedó completada y auditada localmente. Antes de producción falta el preflight remoto de la migración aditiva y, en un lote posterior, revocar las escrituras directas heredadas del Data API una vez desplegado el frontend compatible.
8. **Integridad SQL.** Resuelto localmente; lint local en verde.
9. **Flujos financieros.** Lote local completado para los medios actualmente priorizados: checkout E2E de efectivo con orden sintética, descuento atómico de stock, rechazo de sobre-reserva, liberación idempotente del cron y `place_order_atomic` con rollback de stock/créditos ante un producto inválido. La validación de `moto`/`shipping` interpreta el método decorado por la UI y exige dirección. Mercado Pago permanece explícitamente diferido y fuera del backlog activo.

## P1 — estabilización funcional

- E2E de Pedido completado: `/hang` abre WhatsApp, el modal "Pedido a Japón" calcula el total y `/api/search` devuelve precios.
- E2E autenticado completado con fixtures sintéticos locales: la cuenta estándar ve una compra con su producto, abre el detalle de una importación y expande el detalle de una solicitud de buylist; los fixtures se limpian al finalizar.
- Pruebas de detalle de órdenes, importaciones y buylists completadas con fixtures sintéticos locales.
- Auditoría inicial de formularios administrativos completada: el usuario estándar es redirigido fuera del panel y el admin local puede cargar Inventario, Pedidos, Importaciones, Buylists y Configuración Maestra sin escrituras de prueba.
- Warning de múltiples clientes GoTrue resuelto en este lote: `CsvUploader` e Inventario usan el singleton browser compartido; se eliminó el cliente legacy directo.
- Prueba E2E de contacto completada: un fixture REST aislado verifica que `system_settings` actualiza el Footer y el enlace de WhatsApp sin modificar la base local compartida.
- Mutaciones administrativas de productos completadas: creación/reposición concurrente exacta, edición con ajuste auditado, rechazo de borrado con historial, borrado seguro sin referencias y CSV parcial sin afectar otro inventario.
- Playwright usa el puerto configurado y un solo trabajador porque los E2E locales comparten usuarios y fixtures mutables; la suite completa pasa 16/16 sin interferencias y termina sin residuos sintéticos.
- La suscripción de autenticación del Navbar difiere las consultas de perfil fuera de `onAuthStateChange` y ya no se vuelve a crear al cambiar usuario/perfil; el ciclo usuario estándar/admin pasó 9/9 en repetición focalizada.
- Reemplazar el PIN cliente hardcodeado `1234` del layout administrativo: la autorización real ya vive en proxy/Server Actions/RLS, por lo que el PIN actual es fricción y no un segundo factor.
- Completar E2E de registro, recuperación y actualización de contraseña. Google OAuth aún no está implementado y necesita configuración separada local/staging/producción.
- Completar la auditoría responsive mobile-first del panel administrativo y corregir navegación, tablas y formularios que desborden en móvil/tablet.
- Completar los filtros de Magic con rango de precio y formato; conservar los filtros existentes de orden, color, set, finish, rareza y condición.
- Implementar accesos rápidos administrables bajo el banner: cantidad, orden, imagen/icono, etiqueta, URL y estado activo.
- Portar el Deckbuilder de Magic desde El Perchero únicamente mediante lectura y reimplementación dentro de Crimson, sin compartir credenciales, datos, procesos ni escritura de archivos.

## P2 — calidad y operación

- Reducir la deuda heredada de ESLint; TypeScript estricto ya está integrado al build y queda ESLint como lote independiente.
- Actualizar `baseline-browser-mapping` cuando se abra un lote de dependencias.
- Completar la réplica de Auth/Storage gestionados solo con fixtures sintéticos y documentar qué no se importa.
- Storage productivo pendiente: el dump sanitizado no incluye buckets ni objetos; hay que auditar las políticas de `storage.objects` remotas y decidir si se replica alguna migración antes de promover cambios.
- Añadir inventario de esquema, row-counts y clasificación de datos como artefactos externos verificables.
- Documentar backups locales, restauración y recuperación sin incluir dumps dentro de Git.
- La validación estricta de TypeScript quedó resuelta en el checkpoint `cd2c63c`; mantener `npm run typecheck` como gate obligatorio de cada lote.
- ESLint sigue fuera del gate de promoción: la ejecución completa actual reporta 497 errores y 178 advertencias en la base heredada (principalmente `no-explicit-any` y reglas de efectos React). Los módulos nuevos de este lote pasan el lint focalizado sin hallazgos. La deuda global requiere lotes dedicados, no una corrección mecánica dentro de una migración de seguridad.

## Siguiente backlog recomendado (antes de tocar producción)

1. **Revisar el diseño del lote de emergencia P0.** El diseño por fases quedó escrito en `docs/superpowers/specs/2026-08-29-crimson-crown-emergency-hardening-design.md`: guard entre proyectos, manifiesto/proyección de releases, cierre compatible de Storage y vista/funciones privilegiadas. Falta la revisión manual del documento antes de convertirlo en plan de implementación.
2. **Preparar staging exclusivo de Crimson.** Crear un proyecto/branch no productivo sólo después de confirmar costo y organización; separar las variables de Vercel y probar allí la secuencia completa.
3. **RLS y Data API por grupos.** Después de desplegar el frontend compatible, preparar y probar localmente la revocación de escrituras directas sobre productos/inventarios/movimientos; continuar luego con los demás dominios sin una migración monolítica.
4. **Lotes funcionales.** Admin/mobile/Auth primero; filtros y accesos rápidos después; Deckbuilder como subsistema independiente.
5. **Operación y calidad.** Automatizar snapshots de esquema/row-counts, documentar backup/restauración local y abordar ESLint por grupos pequeños con pruebas de regresión.

## SaaS — después de todo lo anterior

- Extraer configuración por tenant, branding, dominios y roles.
- Separar facturación, límites y observabilidad.
- Crear un proyecto plantilla sin reutilizar datos ni credenciales de Crimson Crown.

## Gates antes del primer push a producción

1. Revisión manual del lote actual y de cualquier migración SQL nueva.
2. Suite local de seguridad y tests de autorización negativos en verde.
3. Build y validación de tipos sin errores nuevos.
4. Pruebas manuales de checkout y stock en un entorno controlado, sin proveedor de pagos real.
5. Orden de promoción: compatibilidad SQL primero, luego RPCs atómicos —incluida `20260829021742_admin_product_mutations.sql`— y finalmente el código que los usa (con backup y ventana controlada); nunca desplegar el frontend antes de que sus RPCs estén disponibles.
6. Verificar manualmente buckets/policies de Storage en producción y decidir si se incluye una migración de Storage; no se debe inferir desde el dump sanitizado.
7. Diff revisado por el propietario; recién entonces se autoriza commit/push y un despliegue separado.
