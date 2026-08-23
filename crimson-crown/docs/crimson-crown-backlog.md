# Crimson Crown — backlog y gates de liberación

Actualizado: 2026-08-23. Este documento cubre únicamente Crimson Crown. SaaS queda fuera de alcance hasta completar la estabilización productiva.

## Estado del entorno local

- La réplica local usa Supabase en loopback y datos públicos sanitizados. Los dumps crudos permanecen fuera del worktree.
- Existe una cuenta admin sintética local y un usuario estándar sintético para pruebas de autorización.
- No se ejecutaron escrituras contra producción ni despliegues. Los checkpoints están publicados únicamente en la rama de trabajo `codex/crimson-crown-safety-foundation`.
- El servidor local se mantiene disponible en `http://127.0.0.1:3000` / `http://localhost:3000`.

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
- RPCs acotados para editar datos propios (`update_profile_details`, `submit_order_payment_proof`), descuento de stock atómico sólo server-side y créditos sin autoacreditación/saldo negativo.
- Wishlist específica: ya no intenta crear productos desde el navegador; si la variante no está catalogada, muestra una salida explícita y conserva la alerta por nombre como alternativa.
- `/api/dolar` lee con la clave pública y persiste el tipo de cambio sólo con service role; `/api/fix-images` exige sesión admin y `/api/cron/release-stock` falla cerrado fuera de loopback si falta `CRON_SECRET`.
- Storage local preparado con buckets sintéticos `payment_proofs`, `products` y `banners`; `scripts/local-db/prepare-storage-fixtures.ps1`, `storage-fixtures.sql` y `storage-matrix.mjs` son sólo de pruebas locales y no deben entrar al push de producción sin auditar las políticas remotas.
- Matriz automatizada `npm run test:local-security`: anon no ve tablas privadas; usuario estándar sólo ve sus recursos, carrito, guardados, órdenes/importaciones/buylists propios y no puede mutar productos, créditos, precios ni tablas administrativas; admin conserva acceso operativo; `supabase db lint` sin errores.
- Pruebas de seguridad local integradas al script `test:environment-safety`.
- Advertencia de `next/image` del logo corregida.
- Host local alternativo normalizado en desarrollo a `127.0.0.1` mediante un redirect de navegador, con prueba E2E de regresión; esto evita separar cookies de Supabase entre `localhost` y `127.0.0.1`.

## P0 — bloquear cualquier promoción a producción

1. **RLS y autorización.** Lote local aplicado y verificado. Antes de producción falta revisar el diff SQL contra el esquema remoto y validar las mismas políticas en una rama/entorno de staging.
2. **Pruebas de autorización negativas.** La matriz cubre tablas administrativas, carrito/guardados, órdenes, items, importaciones, buylists, wishlist, notas, Storage y las escrituras públicas intencionales (`feedback`, `search_logs`, `analytics_visits`) con limpieza de fixtures.
3. **Funciones administrativas.** RPCs críticas y endpoints de service role auditados para este lote; falta verificar contra el esquema remoto que las políticas de Storage productivas coincidan con el comportamiento esperado.
4. **Integridad SQL.** Resuelto localmente; lint local en verde.
5. **Flujos financieros.** Falta probar checkout, webhooks, reserva/liberación de stock y estados de pago con proveedores deshabilitados; nunca confirmar una compra desde pruebas automatizadas.

## P1 — estabilización funcional

- E2E de Pedido completado: `/hang` abre WhatsApp, el modal "Pedido a Japón" calcula el total y `/api/search` devuelve precios.
- E2E autenticado completado con fixtures sintéticos locales: la cuenta estándar ve una compra con su producto, abre el detalle de una importación y expande el detalle de una solicitud de buylist; los fixtures se limpian al finalizar.
- Pruebas de detalle de órdenes, importaciones y buylists completadas con fixtures sintéticos locales.
- Auditoría inicial de formularios administrativos completada: el usuario estándar es redirigido fuera del panel y el admin local puede cargar Inventario, Pedidos, Importaciones, Buylists y Configuración Maestra sin escrituras de prueba.
- Warning de múltiples clientes GoTrue resuelto en este lote: `CsvUploader` e Inventario usan el singleton browser compartido; se eliminó el cliente legacy directo.
- Prueba E2E de contacto completada: un fixture REST aislado verifica que `system_settings` actualiza el Footer y el enlace de WhatsApp sin modificar la base local compartida.

## P2 — calidad y operación

- Reducir la deuda heredada de ESLint y TypeScript; el build actual omite validación de tipos.
- Actualizar `baseline-browser-mapping` cuando se abra un lote de dependencias.
- Completar la réplica de Auth/Storage gestionados solo con fixtures sintéticos y documentar qué no se importa.
- Storage productivo pendiente: el dump sanitizado no incluye buckets ni objetos; hay que auditar las políticas de `storage.objects` remotas y decidir si se replica alguna migración antes de promover cambios.
- Añadir inventario de esquema, row-counts y clasificación de datos como artefactos externos verificables.
- Documentar backups locales, restauración y recuperación sin incluir dumps dentro de Git.

## SaaS — después de todo lo anterior

- Extraer configuración por tenant, branding, dominios y roles.
- Separar facturación, límites y observabilidad.
- Crear un proyecto plantilla sin reutilizar datos ni credenciales de Crimson Crown.

## Gates antes del primer push a producción

1. Revisión manual del lote actual y de cualquier migración SQL nueva.
2. Suite local de seguridad y tests de autorización negativos en verde.
3. Build y validación de tipos sin errores nuevos.
4. Pruebas manuales de checkout y stock en un entorno controlado, sin proveedor de pagos real.
5. Orden de promoción: migraciones SQL primero (con backup y ventana controlada), luego el código que usa los RPC nuevos; nunca desplegar el frontend antes de `decrement_stock`/`update_profile_details` disponibles.
6. Verificar manualmente buckets/policies de Storage en producción y decidir si se incluye una migración de Storage; no se debe inferir desde el dump sanitizado.
7. Diff revisado por el propietario; recién entonces se autoriza commit/push y un despliegue separado.
