# Verificación — mutaciones administrativas seguras de productos

Fecha de cierre local: 2026-08-29  
Rama local: `codex/crimson-admin-product-mutations`  
Estado remoto: sin push, sin deploy y sin migraciones aplicadas a producción

## Resultado

El subproyecto 1 del hardening productivo quedó implementado y verificado contra el Supabase local aislado de Crimson Crown. Las altas/reposiciones, ediciones, borrados y cargas CSV ya no escriben `public.products` desde componentes cliente. La sesión del administrador entra por Server Actions y PostgreSQL vuelve a autorizar, serializar, validar y auditar cada operación.

La migración aditiva preparada es `supabase/migrations/20260829021742_admin_product_mutations.sql`. Sólo está aplicada y registrada en Supabase local. No revoca todavía las escrituras directas heredadas, por lo que puede publicarse antes del frontend compatible sin interrumpir la versión productiva actual.

## Evidencia automatizada

| Control | Resultado |
| --- | --- |
| TypeScript (`tsc --noEmit`) | exit 0 |
| Unit tests de validación, acciones y correo diferido | 13/13 |
| Barreras de entorno y producción | 43/43 |
| Matriz de mutaciones admin | 8 controles, exit 0 |
| Matriz de seguridad/RLS | exit 0 |
| Matriz multi-inventario | 5 controles, exit 0 |
| Matriz financiera | exit 0 |
| Checkout atómico | exit 0 |
| Liberación atómica de stock | exit 0 |
| Playwright completo | 16/16 con un trabajador |
| `supabase db lint --local --schema public --level warning --fail-on error` | sin errores |
| Next.js production build con entorno local validado | exit 0, 44 páginas estáticas generadas |
| Lint focalizado de módulos nuevos | exit 0 |
| Residuos sintéticos posteriores | 0 inventarios, 0 productos, 0 órdenes |

El lint global no es un gate verde todavía: reporta 497 errores y 178 advertencias heredadas, principalmente `no-explicit-any` y reglas de efectos React. No se mezclaron correcciones masivas ajenas en este lote; los módulos nuevos sí pasan el lint focalizado.

## Propiedades comprobadas

- Un usuario estándar no puede invocar las RPCs administrativas.
- Una creación repetida con la misma clave no duplica stock.
- Dos reposiciones concurrentes conservan la suma exacta.
- Una fila CSV negativa se rechaza sin perder la fila válida.
- El inventario seleccionado se mantiene aislado del inventario principal.
- Editar stock genera el movimiento de ajuste exacto.
- Un producto con historial no se elimina y queda reportado en la UI.
- Un producto vacío, sin referencias ni movimientos, sí se puede eliminar.
- Las RPCs son `SECURITY DEFINER`, fijan `search_path`, niegan `anon` y conservan autorización interna con `is_admin()`.
- No quedan escrituras directas a `products` dentro de la UI administrativa.
- El diff sólo contiene archivos de `crimson-crown/`; no contiene dumps, claves ni URLs de Supabase productivas. La referencia a `SUPABASE_SERVICE_ROLE_KEY` existe únicamente en la matriz local, protegida por validación estricta de loopback.

## Revisión manual recomendada antes de producción

En la web local, usando `admin.local@example.test`:

1. Abrir un inventario secundario y crear una variante con stock positivo.
2. Volver a crear la misma variante y comprobar que informa la reposición y suma el stock.
3. Editarla, cambiar stock/precio y recargar la página para confirmar persistencia.
4. Intentar borrar un producto con historial; debe permanecer visible y mostrar `No se eliminaron productos con historial.`.
5. Crear un producto sin stock ni historial y comprobar que se puede borrar.
6. Importar un CSV pequeño con una fila válida y otra con cantidad negativa; debe aplicar una sola vez la válida, reportar un error y no alterar el inventario principal.
7. Revisar catálogo, detalle, carrito y checkout en efectivo para confirmar que las lecturas siguen iguales.

## Gate y orden de promoción futuro

1. Confirmar un backup productivo recuperable y capturar conteos de tablas afectadas.
2. Revisar `migration list` y `db push --dry-run` contra el proyecto exacto de Crimson Crown.
3. Aplicar primero sólo la migración aditiva `20260829021742_admin_product_mutations.sql` y verificar funciones, grants y ausencia de cambios de datos.
4. Desplegar después el frontend que usa las nuevas Server Actions/RPCs.
5. Ejecutar un smoke test administrativo manual acotado y revisar logs.
6. Revocar escrituras directas del Data API en un lote separado, únicamente cuando el frontend nuevo esté confirmado.

Ante una incidencia después del despliegue del frontend, se revierte primero el código a la versión anterior. Las RPCs aditivas pueden permanecer sin uso; no se deben borrar funciones ni datos durante un rollback urgente. Ninguno de estos pasos fue ejecutado como parte de esta verificación local.
