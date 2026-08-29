# Crimson Crown: hardening productivo sin SaaS ni Mercado Pago

Fecha: 2026-08-28

## Objetivo

Completar el backlog operativo y de seguridad de Crimson Crown sin alterar datos productivos durante el desarrollo. El trabajo elimina escrituras administrativas directas desde el navegador, prepara RLS y Storage con privilegio mínimo, separa los entornos no productivos, formaliza pruebas y recuperación, y deja cada promoción a producción detrás de una revisión manual del propietario.

## Alcance y límites

- Trabajar únicamente dentro de `D:\crimson-crown-tcg\crimson-crown`.
- SaaS queda fuera de alcance.
- Mercado Pago, sus SDK, webhooks y estados asociados quedan fuera de alcance. No se eliminará código heredado de pagos en este lote porque esa limpieza sería un cambio funcional separado.
- Ninguna prueba automática puede conectarse a Vercel o Supabase productivos.
- Ningún script local puede contener, imprimir o versionar secretos, dumps crudos ni datos personales productivos.
- No se aplicarán migraciones, variables, despliegues ni escrituras a producción durante la implementación local.
- Antes de cada promoción productiva habrá backup verificable, diff SQL revisado, pruebas locales y aprobación manual.
- Órdenes, usuarios, productos, inventario e historial existentes deben conservarse. Las migraciones productivas serán aditivas antes de revocar permisos heredados.

## Estado de partida

- El código actual está publicado en `origin/main` en `a2e80ec` y el checkout de trabajo está limpio.
- Supabase remoto registra las migraciones de runtime seguro y multi-inventario, pero no todo el esquema histórico está representado en el historial de migraciones.
- El catálogo multi-inventario, la asignación principal-primero y la restitución por origen ya existen.
- `ProductForm`, `CsvUploader` y la eliminación en `/admin/inventory` todavía mutan `public.products` directamente desde el cliente autenticado.
- La base local contiene una matriz RLS más estricta que producción, pero no debe promoverse como un único bloque sin separar dependencias y comprobar compatibilidad.
- `payment_proofs` se consume mediante URLs públicas; volver privado el bucket sin una transición previa rompería comprobantes históricos.
- El asesor de seguridad remoto mantiene como error la vista `public.admin_users` con comportamiento de definidor y reporta funciones heredadas sin `search_path` fijo.
- El E2E completo pasó antes del último lote multi-inventario; el flujo completo debe repetirse sobre el estado actual.

## Descomposición del backlog

El trabajo se divide en cinco subproyectos independientes. Cada uno produce software verificable y puede revisarse o rechazarse sin arrastrar los demás.

1. Frontera segura de mutaciones administrativas de productos.
2. RLS, grants, vistas y funciones del Data API.
3. Comprobantes privados en Storage con compatibilidad histórica.
4. Staging, drift de migraciones, backups, snapshots y rollback.
5. Verificación integral, observabilidad y deuda de calidad.

El orden es obligatorio porque el cierre de permisos de `products` depende de que la interfaz administrativa ya no realice escrituras directas.

## Enfoques considerados

### Seleccionado: sesión del administrador + Server Actions + RPCs autorizadas

La interfaz enviará datos validados a Server Actions. Las acciones usarán la sesión Supabase del administrador y llamarán RPCs transaccionales que vuelven a comprobar `public.is_admin()`, fijan `search_path`, bloquean filas y registran movimientos de stock. Las funciones revocarán `EXECUTE` a `PUBLIC` y `anon`, y lo concederán únicamente a `authenticated` y `service_role` cuando corresponda.

Este enfoque mantiene la identidad real del operador, permite que Postgres sea la última frontera de autorización y elimina carreras de stock sin introducir una clave privilegiada en el navegador.

### Descartado: conservar escrituras directas con una política RLS de administrador

Aunque una política `public.is_admin()` impediría a usuarios normales escribir, la lógica de deduplicación, incremento y auditoría seguiría distribuida entre componentes cliente. Dos cargas simultáneas podrían perder unidades y la futura evolución de RLS seguiría acoplada a detalles internos de la tabla.

### Descartado: usar `service_role` en Server Actions para todas las mutaciones

La clave permanecería técnicamente en el servidor, pero cada acción pasaría a omitir RLS. Un error de validación tendría un radio de impacto mayor y la base perdería la identidad autenticada que necesita para auditoría. `service_role` queda reservado a tareas internas ya justificadas, scripts operativos controlados y recuperación.

## Subproyecto 1: frontera segura de productos

### Componentes

- Un módulo compartido definirá `AdminProductInput`, normalización y validación. Sólo aceptará campos editables del producto; rechazará `id`, `variant_key`, `created_at`, referencias de orden y campos de otros inventarios.
- `saveAdminProduct` será una Server Action para creación, edición y cambio de variante.
- `importAdminProducts` será una Server Action por lotes para CSV. Procesará fragmentos acotados, devolverá resultados por fila y no reintentará silenciosamente errores de validación.
- `deleteAdminProducts` será una Server Action para eliminación individual y masiva dentro del inventario seleccionado.
- Las acciones comprobarán `auth.getUser()` e `isAdminEmail()` antes de llamar la base. La base repetirá la autorización mediante `public.is_admin()`.

### Contratos de base de datos

Se crearán funciones públicas invocables por RPC, todas `SECURITY DEFINER`, con `set search_path = public, pg_temp`, autorización interna y grants explícitos:

- `admin_create_or_restock_product(inventory_id_input uuid, product_input jsonb, operation_key_input text)` devuelve la fila resultante y un indicador `inserted` o `restocked`.
- `admin_update_product(product_id_input uuid, inventory_id_input uuid, product_input jsonb, operation_key_input text)` reemplaza los campos editables y devuelve la fila actualizada.
- `admin_delete_products(inventory_id_input uuid, product_ids_input uuid[], operation_key_input text)` devuelve el número eliminado y los IDs rechazados por referencias históricas.

Las funciones no confiarán en `variant_key`: la calcularán con `build_product_variant_key`. La creación o reposición bloqueará la variante de un inventario antes de incrementar stock. La edición bloqueará el producto y rechazará un cambio de identidad que colisione con otra fila del mismo inventario. Stock y precio deben ser números finitos; stock será entero no negativo.

Cada diferencia de stock generará una fila en `inventory_stock_movements` con el usuario autenticado, el delta real y una `reference_key` idempotente derivada de `operation_key_input`. Repetir la misma operación devolverá el resultado existente sin volver a sumar o restar stock.

La eliminación sólo afectará IDs pertenecientes al inventario recibido. Rechazará productos referenciados por órdenes o movimientos históricos. No habrá cascadas sobre pedidos, items o auditoría.

### Comportamiento de interfaz

- Editar un producto reemplaza el stock por el valor mostrado, igual que hoy.
- Crear una variante ya existente incrementa stock, igual que hoy, pero atómicamente.
- CSV incrementa stock por variante y reporta filas insertadas, actualizadas o rechazadas.
- Las notificaciones de wishlist se ejecutan sólo para productos cuyo stock pasa de cero a positivo o recibe una entrada positiva confirmada por la RPC.
- El botón de eliminación muestra los elementos que no pudieron borrarse por historial y conserva la selección de esos elementos.
- Las imágenes de productos continúan en el bucket público `products`; su política de escritura se cerrará a administradores en el subproyecto 2.

### Errores

Los errores de autorización no revelarán si existe un producto o inventario. Las acciones mapearán códigos de Postgres a mensajes estables en español: acceso denegado, inventario inexistente o archivado, datos inválidos, colisión de variante y producto con historial. Errores desconocidos se registrarán en servidor sin incluir el payload completo.

## Subproyecto 2: RLS y superficie del Data API

El hardening se promoverá por grupos, nunca como una migración monolítica:

1. `products`, `inventories`, `inventory_stock_movements` y RPCs administrativas.
2. Perfiles, órdenes, items, importaciones, buylists, wishlist y créditos.
3. Tablas de configuración, analítica, logs, oportunidades y notificaciones.
4. Vistas y funciones heredadas.

Para `products`, `anon` y `authenticated` conservarán sólo lectura de filas pertenecientes a inventarios activos y no archivados; un administrador podrá leer también inventarios inactivos. `INSERT`, `UPDATE` y `DELETE` directos se revocarán a clientes después de publicar y verificar las Server Actions. `service_role` mantendrá los permisos necesarios para procesos internos.

`public.admin_users` se mantendrá por compatibilidad, con `security_invoker = on` y sin grants para `anon` o `authenticated` mientras no exista un consumidor demostrado. Las funciones expuestas fijarán `search_path`; toda función `SECURITY DEFINER` revocará el permiso implícito de `PUBLIC` y validará usuario, rol y pertenencia de la fila.

Cada tabla tendrá pruebas positivas y negativas para `anon`, usuario estándar, administrador y `service_role`. Grants y políticas vivirán en la misma migración.

## Subproyecto 3: Storage privado para comprobantes

`payment_proofs` pasará a ser privado sólo al final de una transición compatible:

1. Los uploads nuevos usarán rutas con propietario: `<user-id>/<scope>/<uuid>.<ext>`.
2. La base almacenará la ruta del objeto, no una URL pública nueva.
3. Lecturas de usuario y administrador obtendrán URLs firmadas de corta duración desde servidor.
4. Un adaptador reconocerá URLs públicas históricas, extraerá la ruta y generará una URL firmada sin modificar primero la fila original.
5. Una migración de datos posterior guardará rutas normalizadas cuando todos los formatos históricos hayan sido inventariados.
6. Sólo después de verificar órdenes, importaciones y comisiones se marcará privado el bucket.

Las políticas permitirán al usuario autenticado insertar y leer objetos bajo su propio prefijo. Administradores podrán leer todos los comprobantes. Los reemplazos requerirán explícitamente `INSERT`, `SELECT` y `UPDATE`. Productos y banners permanecerán públicos para lectura, con escritura exclusiva de administradores.

## Subproyecto 4: staging, drift y recuperación

- Preview y Development no compartirán URL ni claves con producción.
- El proyecto no productivo se creará sólo después de conocer y aceptar su costo. La réplica utilizará esquema y datos sanitizados, nunca un volcado crudo dentro del repositorio.
- Se generará un baseline verificable del esquema remoto antes de nuevas migraciones. El historial local se reconciliará sin volver a ejecutar migraciones históricas sobre objetos ya existentes.
- Antes de cada promoción se capturarán conteos por tabla, estado de migraciones, funciones y políticas afectadas.
- Cada lote tendrá SQL de verificación y un procedimiento de recuperación específico. El rollback no eliminará columnas o datos recién escritos; primero restaurará compatibilidad de permisos o código.

## Subproyecto 5: verificación y calidad

- Repetir el flujo Playwright completo del estado actual y el E2E multi-inventario con fixtures locales.
- Añadir pruebas de concurrencia e idempotencia para formulario, CSV y borrado.
- Ejecutar matrices RLS y Storage, TypeScript y build en cada checkpoint.
- Incorporar gates de CI que bloqueen URLs productivas en pruebas y archivos de dumps o secretos.
- Actualizar el backlog y los runbooks con evidencia reproducible.
- Resolver ESLint en lotes por regla y dominio. No se mezclarán correcciones masivas de estilo con migraciones de seguridad.
- Actualizar `baseline-browser-mapping` dentro de un lote de dependencias separado.

## Estrategia de pruebas

Las pruebas de base usarán únicamente Supabase local y cuentas sintéticas:

- `anon` y usuario estándar no pueden invocar RPCs administrativas ni escribir `products` directamente.
- Un administrador puede crear, editar, reponer y eliminar dentro del inventario indicado.
- Dos reposiciones concurrentes conservan la suma exacta.
- Repetir una `operation_key` no duplica stock ni movimientos.
- Una variante igual en otro inventario no se fusiona.
- Un producto referenciado históricamente no se elimina.
- CSV produce resultados por fila y conserva las filas válidas aunque otra sea rechazada.
- El E2E confirma que los formularios usan la nueva frontera y que catálogo, checkout y restauración siguen funcionando.
- Storage prueba aislamiento por propietario, acceso administrativo, URLs firmadas y denegación anónima.

La verificación final de cada lote incluye pruebas focalizadas, matrices locales, `npm run typecheck`, `npm run build` y revisión de que ningún comando o fixture apunte fuera de loopback. El lint completo se reportará con su deuda remanente hasta que su lote dedicado llegue a cero.

## Orden de promoción futura

Cada paso requiere revisión manual y puede detenerse sin bloquear producción:

1. Migración aditiva con RPCs, sin revocar escrituras actuales.
2. Despliegue del código que usa Server Actions y RPCs.
3. Smoke test administrativo controlado y revisión de logs.
4. Migración que revoca escrituras directas y activa las políticas definitivas.
5. Verificación de catálogo, inventario, órdenes y métricas.
6. Transición de Storage por separado; el bucket se vuelve privado en el último paso.

No se crearán inventarios secundarios ni órdenes de prueba en producción como parte de la promoción. Los checks productivos serán de lectura o acciones manuales acordadas con el propietario.

## Criterios de cierre

- No existen mutaciones directas de `products` desde componentes cliente administrativos.
- Las mutaciones de producto son atómicas, idempotentes, autorizadas y auditadas.
- Los clientes no pueden escribir tablas administrativas mediante Data API.
- `admin_users` no opera como vista definidora expuesta.
- Los comprobantes no son públicamente descargables y los históricos siguen accesibles para sus dueños y administradores.
- Preview y Development no apuntan a producción.
- El drift de migraciones, backup y recuperación están documentados y ensayados.
- Todas las matrices locales, E2E, TypeScript y build están en verde.
- El backlog de calidad restante contiene únicamente lotes no críticos explícitos; SaaS y Mercado Pago permanecen excluidos.
