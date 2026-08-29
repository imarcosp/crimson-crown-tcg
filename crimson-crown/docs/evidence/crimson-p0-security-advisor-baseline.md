# Baseline local del advisor de seguridad P0

Fecha: 2026-08-29. Entorno observado: exclusivamente `supabase_db_crimson-crown`, con Data API local `http://127.0.0.1:54621`. No se consultó ni modificó producción o staging durante esta captura.

## Delta verificable

| Medida | Conteo local | Criterio |
| --- | ---: | --- |
| Mutable search paths (24 objetivo) | 0 | Las 24 firmas de `docs/security/crimson-security-definer-inventory.json` tienen `search_path=public, pg_temp`. |
| SECURITY DEFINER ejecutables por `anon` | 0 | Conteo efectivo con `has_function_privilege`, no sólo lectura de `proacl`. |
| SECURITY DEFINER ejecutables por `authenticated` | 25 | RPC de negocio enumeradas abajo; no es una excepción global ni un objetivo de cero. |

La captura se reproduce con:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-db/verify-privileged-surfaces.ps1
npm run test:local-authenticated-definers
npm run test:privileged-surfaces
```

El conteo amplio de definers se obtuvo con una consulta de catálogo read-only dentro del contenedor exacto:

```sql
select
  count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')) as anon_effective,
  count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')) as authenticated_effective
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef;
-- anon_effective = 0; authenticated_effective = 25
```

El verificador fija contenedor, host y puerto; sus aserciones consultan `pg_proc.proconfig`, ACL explícita y privilegio efectivo heredado. La matriz Data API vuelve a verificar el catálogo antes de probar permisos, exige errores asociados a la función exacta y no acepta errores genéricos de tabla, secuencia o cuerpo.

Artefactos usados en la captura (SHA-256): inventario `0B754D4AC56747AEFC29CD1A49B8E8E32495F6533A83033AA88F8CA1C4F001D2`, migración `C7C72AE2EF51EC9C6BE0998D1782F29D55DD49B3295F776C49C08244E25615CE` y verificador SQL `BE36DD49A3BFB34FAC13D69A6D1D20F58948835FF572B058FF57247352D6BC46`.

## Definers retenidas para `authenticated`

Cada fila contiene una evidencia de autorización interna, una prueba positiva de autorización (puede terminar en una validación de dominio posterior al guard) y una prueba negativa. Las rutas, líneas y anclas se validan desde `authenticated-definer-contract.test.mjs`.

<!-- authenticated-definers:start -->
| Firma | Autorización interna | Prueba positiva | Prueba negativa |
| --- | --- | --- | --- |
| `public.admin_create_or_restock_product(uuid,jsonb,text)` | `supabase/migrations/20260829021742_admin_product_mutations.sql:152` · `not public.is_admin()` | `scripts/local-db/admin-product-mutations-matrix.mjs:100` · `admin.rpc('admin_create_or_restock_product'` | `scripts/local-db/admin-product-mutations-matrix.mjs:81` · `standard.rpc('admin_create_or_restock_product'` |
| `public.admin_delete_products(uuid,uuid[],text)` | `supabase/migrations/20260829021742_admin_product_mutations.sql:378` · `not public.is_admin()` | `scripts/local-db/admin-product-mutations-matrix.mjs:254` · `admin.rpc('admin_delete_products'` | `scripts/local-db/admin-product-mutations-matrix.mjs:92` · `standard.rpc('admin_delete_products'` |
| `public.admin_update_product(uuid,uuid,jsonb,text)` | `supabase/migrations/20260829021742_admin_product_mutations.sql:273` · `not public.is_admin()` | `scripts/local-db/admin-product-mutations-matrix.mjs:188` · `admin.rpc('admin_update_product'` | `scripts/local-db/admin-product-mutations-matrix.mjs:86` · `standard.rpc('admin_update_product'` |
| `public.append_import_order_user_note(bigint,text)` | `supabase/migrations/20260826120000_production_runtime_functions.sql:318` · `if auth.uid() is null then` | `scripts/local-db/authenticated-definer-matrix.mjs:215` · `standard.rpc('append_import_order_user_note'` | `scripts/local-db/authenticated-definer-matrix.mjs:214` · `append note cross-owner` |
| `public.approve_buylist_transaction(uuid,numeric)` | `supabase/migrations/20260826120000_production_runtime_functions.sql:137` · `not public.is_admin()` | `scripts/local-db/authenticated-definer-matrix.mjs:199` · `admin.rpc(probe.name` | `scripts/local-db/authenticated-definer-matrix.mjs:198` · `standard.rpc(probe.name` |
| `public.archive_inventory(uuid)` | `supabase/migrations/20260827020755_create_multi_inventory_system.sql:244` · `not public.is_admin()` | `scripts/local-db/authenticated-definer-matrix.mjs:199` · `admin.rpc(probe.name` | `scripts/local-db/authenticated-definer-matrix.mjs:198` · `standard.rpc(probe.name` |
| `public.cancel_order_atomic(uuid,boolean,boolean)` | `supabase/migrations/20260827020830_multi_inventory_runtime_functions.sql:339` · `not public.is_admin()` | `scripts/local-db/authenticated-definer-matrix.mjs:199` · `admin.rpc(probe.name` | `scripts/local-db/authenticated-definer-matrix.mjs:198` · `standard.rpc(probe.name` |
| `public.create_inventory(text,text,text)` | `supabase/migrations/20260827020755_create_multi_inventory_system.sql:186` · `not public.is_admin()` | `scripts/local-db/authenticated-definer-matrix.mjs:199` · `admin.rpc(probe.name` | `scripts/local-db/authenticated-definer-matrix.mjs:198` · `standard.rpc(probe.name` |
| `public.decrement_stock(integer,uuid)` | `supabase/migrations/20260826120000_production_runtime_functions.sql:226` · `not public.is_admin()` | `scripts/local-db/financial-matrix.mjs:55` · `admin.rpc('decrement_stock'` | `scripts/local-db/security-matrix.mjs:418` · `standard.rpc('decrement_stock'` |
| `public.delete_inventory_safely(uuid)` | `supabase/migrations/20260827020755_create_multi_inventory_system.sql:269` · `not public.is_admin()` | `scripts/local-db/authenticated-definer-matrix.mjs:199` · `admin.rpc(probe.name` | `scripts/local-db/authenticated-definer-matrix.mjs:198` · `standard.rpc(probe.name` |
| `public.get_inventory_metrics(uuid)` | `supabase/migrations/20260827020830_multi_inventory_runtime_functions.sql:598` · `not public.is_admin()` | `scripts/local-db/authenticated-definer-matrix.mjs:199` · `admin.rpc(probe.name` | `scripts/local-db/authenticated-definer-matrix.mjs:198` · `standard.rpc(probe.name` |
| `public.is_admin()` | `supabase/migrations/20260826120000_production_runtime_functions.sql:17` · `where id = (select auth.uid())` | `scripts/local-db/authenticated-definer-matrix.mjs:129` · `admin.rpc('is_admin'` | `scripts/local-db/authenticated-definer-matrix.mjs:126` · `standard.rpc('is_admin'` |
| `public.is_commission_admin()` | `supabase/migrations/20260823043637_local_security_baseline.sql:459` · `select public.is_admin()` | `scripts/local-db/security-matrix.mjs:229` · `admin.rpc('is_commission_admin'` | `scripts/local-db/security-matrix.mjs:225` · `standard.rpc('is_commission_admin'` |
| `public.manage_credits(uuid,numeric,text,text,uuid)` | `supabase/migrations/20260826120000_production_runtime_functions.sql:45` · `not public.is_admin()` | `scripts/local-db/authenticated-definer-matrix.mjs:224` · `standard.rpc('manage_credits'` | `scripts/local-db/authenticated-definer-matrix.mjs:221` · `standard.rpc('manage_credits'` |
| `public.place_order_atomic(jsonb,text,text,jsonb,boolean,text,text,text)` | `supabase/migrations/20260827020830_multi_inventory_runtime_functions.sql:40` · `if v_user_id is null then` | `scripts/local-db/checkout-atomic-matrix.mjs:118` · `standard.rpc('place_order_atomic'` | `scripts/local-db/checkout-atomic-matrix.mjs:28` · `anonymous.rpc('place_order_atomic'` |
| `public.refund_order_atomic(uuid,boolean,numeric)` | `supabase/migrations/20260827020830_multi_inventory_runtime_functions.sql:387` · `not public.is_admin()` | `scripts/local-db/authenticated-definer-matrix.mjs:199` · `admin.rpc(probe.name` | `scripts/local-db/authenticated-definer-matrix.mjs:198` · `standard.rpc(probe.name` |
| `public.release_expired_orders_atomic(integer,text)` | `supabase/migrations/20260827020830_multi_inventory_runtime_functions.sql:546` · `not public.is_admin()` | `scripts/local-db/release-stock-atomic-matrix.mjs:80` · `admin.rpc('release_expired_orders_atomic'` | `scripts/local-db/release-stock-atomic-matrix.mjs:107` · `anonymous.rpc('release_expired_orders_atomic'` |
| `public.remove_order_item_atomic(uuid,integer,boolean)` | `supabase/migrations/20260827020830_multi_inventory_runtime_functions.sql:448` · `not public.is_admin()` | `scripts/local-db/authenticated-definer-matrix.mjs:199` · `admin.rpc(probe.name` | `scripts/local-db/authenticated-definer-matrix.mjs:198` · `standard.rpc(probe.name` |
| `public.restore_order_inventory_atomic(uuid,text)` | `supabase/migrations/20260827020830_multi_inventory_runtime_functions.sql:263` · `not public.is_admin()` | `scripts/local-db/authenticated-definer-matrix.mjs:199` · `admin.rpc(probe.name` | `scripts/local-db/authenticated-definer-matrix.mjs:198` · `standard.rpc(probe.name` |
| `public.restore_stock(uuid)` | `supabase/migrations/20260827020830_multi_inventory_runtime_functions.sql:317` · `perform public.restore_order_inventory_atomic` | `scripts/local-db/authenticated-definer-matrix.mjs:199` · `admin.rpc(probe.name` | `scripts/local-db/authenticated-definer-matrix.mjs:198` · `standard.rpc(probe.name` |
| `public.set_inventory_active(uuid,boolean)` | `supabase/migrations/20260827020755_create_multi_inventory_system.sql:215` · `not public.is_admin()` | `scripts/local-db/authenticated-definer-matrix.mjs:199` · `admin.rpc(probe.name` | `scripts/local-db/authenticated-definer-matrix.mjs:198` · `standard.rpc(probe.name` |
| `public.submit_order_payment_proof(uuid,text)` | `supabase/migrations/20260826120000_production_runtime_functions.sql:282` · `auth.role(), 'anon') <> 'authenticated'` | `scripts/local-db/authenticated-definer-matrix.mjs:241` · `standard.rpc('submit_order_payment_proof'` | `scripts/local-db/authenticated-definer-matrix.mjs:238` · `standard.rpc('submit_order_payment_proof'` |
| `public.transfer_credits(text,numeric,text)` | `supabase/migrations/20260826120000_production_runtime_functions.sql:86` · `auth.role(), 'anon') <> 'authenticated'` | `scripts/local-db/authenticated-definer-matrix.mjs:247` · `standard.rpc('transfer_credits'` | `scripts/local-db/authenticated-definer-matrix.mjs:111` · `anon no debe invocar` |
| `public.update_profile_details(text,text,text)` | `supabase/migrations/20260826120000_production_runtime_functions.sql:255` · `auth.role(), 'anon') <> 'authenticated'` | `scripts/local-db/authenticated-definer-matrix.mjs:252` · `standard.rpc('update_profile_details'` | `scripts/local-db/authenticated-definer-matrix.mjs:111` · `anon no debe invocar` |
| `public.user_accept_buylist_offer(uuid)` | `supabase/migrations/20260826120000_production_runtime_functions.sql:171` · `auth.role(), 'anon') <> 'authenticated'` | `scripts/local-db/authenticated-definer-matrix.mjs:268` · `buylist positive-auth` | `scripts/local-db/authenticated-definer-matrix.mjs:267` · `buylist cross-owner` |
<!-- authenticated-definers:end -->

`transfer_credits(text,numeric,text)` y `update_profile_details(text,text,text)` no tienen un caller `authenticated` válido que deba ser rechazado antes del negocio: su política intencional autoriza a todo usuario autenticado a operar únicamente sobre su identidad. Su polo negativo es por ello el rechazo exacto de `anon` por ACL; el polo positivo usa un usuario autenticado y restaura el perfil. Las otras 23 filas prueban `anon` y además un guard administrativo, de propietario o de identidad según corresponda.

La matriz nueva cierra 17 brechas: 17 pruebas positive-auth, 15 rechazos internos authenticated y las dos excepciones de identidad anteriores. Limpia toda fixture y termina con cero órdenes buylist, transacciones de crédito, órdenes de importación, notificaciones, órdenes y drift de perfiles.

## Lint y criterio de aceptación

Supabase CLI exacto `2.113.0` devolvió `No schema errors found` con `db lint --local --schema public --level warning --fail-on error`. El baseline acepta únicamente las 25 definers de negocio de la tabla; cualquier firma adicional, `anon` efectivo, path mutable objetivo o evidencia sin ambos polos bloquea el release.
