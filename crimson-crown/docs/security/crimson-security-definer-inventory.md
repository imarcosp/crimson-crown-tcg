# Inventario de superficies privilegiadas de Postgres

Fecha de captura: 2026-08-29. Alcance: las 24 firmas reportadas por el advisor de producción por `search_path` mutable. El JSON contiguo es el contrato ejecutable; este documento explica las decisiones y las diferencias observadas.

## Identidad y método

- Producción permitida y consultada sólo en lectura: `djfqozfaqkqdoqeoqbzt` (`Crimson Crown`).
- Espejo local permitido y consultado sólo en lectura: contenedor exacto `supabase_db_crimson-crown`.
- El catálogo consultó `pg_proc.prosecdef`, `proconfig`, `proacl`, argumentos de identidad, propietario y lenguaje.
- Los consumidores de base se resolvieron con `pg_trigger` (incluido el esquema `auth`), expresiones de `pg_policy` y cuerpos de `pg_proc`. Los consumidores de aplicación se buscaron bajo `src/` y `scripts/`.
- No se ejecutó ninguna función inventariada ni se modificó ningún dato, objeto o historial remoto/local.

## Decisión de roles objetivo

| Perfil | Firmas | Roles objetivo | Prueba de autorización/consumo |
| --- | --- | --- | --- |
| Trigger-only | `assign_import_order_number()`, `generate_import_order_number()`, `handle_new_user()`, cinco `notify_*()`, ambos `on_commission_*_change()`, ambos `set_*_commission_eligible()`, `sync_product_prices()` | `service_role` | Trigger exacto en `pg_trigger`; sin llamadas de navegador. El propietario conserva la ejecución de trigger. |
| Server Action de comisiones | ambos `refresh_commission_period(...)`, `recalculate_commission_period_status(uuid)` | `service_role` | `src/app/actions/commissions.ts:252-305`: `requireCommissionAdmin()` antes de `createServiceRoleClient()` y de las RPC. |
| Mantenimiento/lectura interna | `calculate_import_order_total(bigint)`, `delete_trash_products(integer)`, `find_orders_by_id_part(text)`, `generate_next_import_order_number()`, `get_inventory_valuation()`, `get_trash_products(integer)` y `merge_duplicate_products(integer)` | `service_role` | Sin consumidor browser. Los dos scripts operacionales exigen `SUPABASE_SERVICE_ROLE_KEY`; los demás son helpers internos o dependencias de comisiones. |
| Predicado RLS | `is_commission_admin()` | `authenticated`, `service_role` | Cinco políticas SELECT lo evalúan. La versión local delega en `public.is_admin()` (`20260823043637_local_security_baseline.sql:453`). `PUBLIC` y `anon` no son roles objetivo. |

Las funciones trigger no se consideran “sin consumidor” por no aparecer en TypeScript: la consulta de `pg_trigger` prueba la dependencia de base. Igualmente, las dependencias internas observadas fueron idénticas local/producción: ambos `on_commission_*_change()` llaman a `recalculate_commission_period_status(uuid)` y el overload completo de `refresh_commission_period` llama tanto al recálculo como a `calculate_import_order_total(bigint)`.

Cada evidencia `repository` del JSON se valida contra un archivo real confinado al repositorio, una línea y un texto ancla. Las evidencias `catalog` usan un identificador no-file explícito y nunca declaran una línea ficticia.

## Diferencias local/producción que bloquean una equivalencia asumida

- Producción conserva `search_path` mutable en las 24 firmas; local ya fija `public, pg_temp` en cinco: `assign_import_order_number()`, `find_orders_by_id_part(text)`, `generate_next_import_order_number()`, `is_commission_admin()` y `merge_duplicate_products(integer)`.
- Producción permite ejecución mediante `PUBLIC`, `anon`, `authenticated` y `service_role` en las 24 firmas. Local ya restringe once ACL: las cinco anteriores, `handle_new_user()` y los cinco `notify_*()`; `find_orders_by_id_part(text)` y `merge_duplicate_products(integer)` todavía incluyen `authenticated` localmente.
- `is_commission_admin()` y `merge_duplicate_products(integer)` son `SECURITY INVOKER` en producción pero `SECURITY DEFINER` en local. El campo `security` del JSON refleja producción; ambos estados observados quedan bajo `catalog`.
- `auth.users.on_auth_user_created -> public.handle_new_user()` existe en producción y falta en el espejo local. Esta diferencia no autoriza a recrear el trigger en esta tarea; queda como drift explícito para verificación posterior.
- Los otros 13 registros de `pg_trigger`, las cinco políticas de `is_commission_admin()` y las cuatro dependencias entre funciones coinciden entre ambos entornos.

## Excepciones revisables

La única excepción al perfil service-only en este lote es `is_commission_admin()`: `authenticated` necesita ejecutarla indirectamente desde las cinco políticas RLS de comisiones. La autorización no descansa sólo en el grant: el cuerpo productivo actual valida el email de `auth.jwt()` y el cuerpo local objetivo delega en `public.is_admin()`. Antes del release, el contrato de la migración exigirá revocar `PUBLIC`/`anon` y conservar sólo `authenticated`/`service_role`.

No se acepta ninguna otra advertencia por ausencia de consumidor. Las funciones de lectura/mantenimiento abarcan órdenes, productos, stock o información financiera y, al no existir un consumidor de cliente, se clasifican con privilegio mínimo `service_role`.

## Estado de la tarea

El inventario está completo y versionado. Las aserciones que exigen la migración `_harden_privileged_surfaces.sql` deben continuar en rojo hasta la Task 2; este documento no crea ni aplica esa migración.
