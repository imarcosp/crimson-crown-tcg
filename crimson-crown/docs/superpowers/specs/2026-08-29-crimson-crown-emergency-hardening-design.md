# Crimson Crown: diseño de hardening P0 y reconciliación de releases

Fecha: 2026-08-29

Estado: diseño aprobado en conversación; pendiente de revisión del documento antes de redactar el plan de implementación.

## Relación con el diseño anterior

Este documento complementa y, cuando exista conflicto, sustituye las secciones de Storage, staging, drift y promoción de `2026-08-28-crimson-crown-production-hardening-design.md`. La frontera de mutaciones administrativas de productos y el orden funcional definidos allí siguen vigentes.

La ampliación es necesaria porque el preflight remoto de solo lectura encontró condiciones que no estaban representadas completamente en el diseño anterior:

- el historial productivo contiene cinco versiones que no existen con esos timestamps en el repositorio;
- el checkout contiene una configuración ignorada llamada `.env.staging` que en realidad apunta a **El Perchero - Staging**;
- Storage productivo permite escrituras públicas sobre `products` y lectura pública de comprobantes;
- la vista `public.admin_users` continúa expuesta con comportamiento `SECURITY DEFINER`;
- la configuración local de Supabase deshabilita migraciones por diseño, de modo que un `db push --dry-run` directo puede producir un falso “up to date”.

## Objetivo y límites inviolables

El objetivo es eliminar las rutas P0 que podrían mezclar proyectos, aplicar una secuencia incorrecta de migraciones o permitir escrituras no autorizadas, preservando cada orden, usuario, producto, unidad de inventario, comprobante y URL histórica.

Se aplican estos límites:

- Sólo se modifica Crimson Crown dentro de su rama y worktree aislados.
- El Perchero es una fuente de código de sólo lectura para el futuro Deckbuilder; no se usan su Supabase, archivos, procesos, credenciales ni staging.
- Che Maracucho queda completamente fuera de alcance.
- SaaS y Mercado Pago continúan excluidos.
- El desarrollo y las pruebas automáticas usan Supabase local y datos sintéticos o sanitizados.
- Ningún comando de este lote ejecuta `db push`, `migration repair`, despliegues o cambios de variables productivas.
- Toda futura promoción requiere backup recuperable, diff exacto, staging exclusivo de Crimson, pruebas en verde y aprobación manual.
- Ningún rollback destructivo borra columnas, objetos de Storage o datos escritos; se restaura compatibilidad de código o permisos antes de retirar estructuras.

## Identidades autorizadas

Las identidades conocidas se tratan como datos de control, no como configuración intercambiable:

| Entorno | Proyecto Supabase | Uso permitido |
| --- | --- | --- |
| Crimson Crown producción | `djfqozfaqkqdoqeoqbzt` | Sólo producción; lecturas de preflight y promociones manualmente aprobadas |
| Crimson Crown local | `127.0.0.1` o `localhost`, puerto local configurado | Desarrollo y pruebas |
| Crimson Crown staging | Proyecto nuevo y exclusivo, aún no creado | Preview, Development remoto y ensayo de release |
| El Perchero Staging | `jzkxvgntwompkntimrao` | Prohibido para Crimson |
| El Perchero producción | `tszglqwrklthnzhqdffn` | Prohibido para Crimson |
| Che Maracucho | `shwqihiueeuqeumdoepn` | Prohibido para Crimson |

El valor de la futura referencia staging de Crimson se configurará como allowlist de entorno y no se inventará ni se reutilizará. El ref no es una credencial: el servidor conserva la variable autoritativa y el navegador recibe una copia pública que el build exige que sea idéntica; las claves continúan separadas y secretas según su rol. Hasta que exista el ref, Preview y Development remotos deben fallar cerrados.

## Fase 0: guard de entorno y release fail-closed

### Contrato

Un módulo único clasificará la URL de Supabase antes de crear clientes:

- `VERCEL_ENV=production` acepta únicamente el host de Crimson Crown producción.
- `VERCEL_ENV=preview` o `development` en Vercel acepta únicamente la referencia declarada como staging de Crimson y rechaza la referencia productiva.
- ejecución local y test aceptan sólo `http://127.0.0.1:<puerto>` o `http://localhost:<puerto>`; la suite actual usa el puerto local `54621`.
- las tres referencias ajenas conocidas se rechazan en cualquier entorno, incluso si alguien intenta allowlistearlas por error;
- una URL Supabase arbitraria, una URL malformada o una combinación de variables incompleta detiene el arranque/build con un mensaje que identifica la clase de error, pero no imprime URLs, claves ni valores recibidos.

El guard se prueba como función pura y también en los puntos de creación de cliente servidor, navegador y middleware/proxy. La prueba de producción no realiza red: sólo valida configuración sintética.

### Configuración Vercel

Cuando exista el staging exclusivo:

- Production conservará exclusivamente URL y claves de Crimson producción;
- Preview y Development recibirán exclusivamente URL y claves del staging Crimson;
- `SUPABASE_SERVICE_ROLE_KEY` no se expondrá con prefijo `NEXT_PUBLIC_` y sólo existirá donde una Server Action justificada la use;
- staging deshabilitará correos externos, cron con efectos, webhooks comerciales y cualquier integración capaz de contactar clientes;
- las URLs de redirect de Auth se declararán por entorno y no mezclarán dominios productivos con previews.

La creación del proyecto staging tiene posible costo y es una acción externa; se realiza como checkpoint separado después de aceptar el plan de implementación.

## Fase 1: reconciliación segura del historial de migraciones

### Estado observado

Producción registra estas cinco versiones:

| Versión remota | Nombre remoto | Fuente local candidata |
| --- | --- | --- |
| `20260826210617` | `production_runtime_functions` | `20260826120000_production_runtime_functions.sql` |
| `20260826210725` | `revoke_is_admin_anon` | `20260826121500_revoke_is_admin_anon.sql` |
| `20260827051550` | `create_multi_inventory_system` | `20260827020755_create_multi_inventory_system.sql` |
| `20260827051604` | `multi_inventory_runtime_functions` | `20260827020830_multi_inventory_runtime_functions.sql` |
| `20260827051615` | `add_external_prices_name_search_index` | `20260827024000_add_external_prices_name_search_index.sql` |

El repositorio contiene 22 versiones locales que producción no reconoce con esos timestamps. Los cinco pares anteriores son candidatos por nombre y propósito, no equivalencias asumidas.

`supabase/config.toml` conserva `[db.migrations].enabled = false` porque la réplica local se reconstruye desde dump. Esa decisión local no puede usarse como gate de releases.

### Enfoque seleccionado: manifiesto y proyección de release inmutable

No se ejecutará la sugerencia automática `migration repair --status reverted`, porque convertiría migraciones ya aplicadas en pendientes y podría volver a ejecutar DDL o lógica con efecto en datos.

Se añadirá un manifiesto versionado de releases con tres clases:

1. `remote_applied`: las cinco versiones remotas y su archivo fuente local equivalente, respaldadas por comparación normalizada de statements, objetos resultantes y grants;
2. `baseline_present`: migraciones históricas locales cuyos efectos ya existen en el esquema productivo aunque Supabase no registrara su timestamp;
3. `forward_pending`: migraciones nuevas creadas después del baseline y destinadas a promoción.

Un script generará en un directorio temporal ignorado una proyección `supabase/` exclusiva para release:

- copia `config.toml` y habilita migraciones sólo en la copia temporal;
- crea entradas con las cinco versiones remotas exactas para que el CLI reconozca el historial aplicado;
- excluye del conjunto ejecutable los archivos clasificados y comprobados como `baseline_present`;
- incluye sin modificar únicamente las migraciones `forward_pending` aprobadas;
- valida que cada archivo versionado esté clasificado exactamente una vez y que su hash coincida con el manifiesto;
- rechaza archivos desconocidos, hashes cambiados, duplicados, retrocesos de timestamp o un proyecto enlazado distinto a Crimson Crown;
- elimina el directorio temporal al finalizar sin imprimir credenciales.

Este enfoque evita modificar el historial remoto y evita renombrar migraciones históricas que la réplica local ya conoce. El `db push --linked --dry-run` futuro se ejecuta sólo desde la proyección y debe mostrar exactamente el lote aprobado. Un dry-run ejecutado desde el árbol normal se considera inválido por definición.

### Evidencia requerida para clasificar el baseline

Cada entrada del manifiesto adjunta evidencia reproducible:

- comparación de statements remotos y SQL local, cuando el historial remoto conserva statements;
- existencia y firma de tablas, columnas, constraints, índices, funciones y vistas relevantes;
- propietario, `security_invoker`/`security_definer`, `search_path`, grants y políticas RLS;
- conteos, no contenido personal, de las tablas afectadas antes y después del ensayo;
- ejecución de la secuencia en una copia staging exclusiva de Crimson;
- resultado del dry-run de la proyección.

Si una migración histórica no es equivalente, no se marca como baseline: se expresa su diferencia como una migración forward-only nueva. El manifiesto no autoriza SQL por sí mismo; sólo construye una vista consistente del historial.

## Fase 2: superficie privilegiada de Postgres

Los hallazgos se corrigen por dominio, no con una migración monolítica.

### `public.admin_users`

No existe consumidor de aplicación identificado para esta vista. Se mantiene temporalmente para compatibilidad de esquema, pero:

- se activa `security_invoker = true`;
- se revoca todo acceso a `PUBLIC`, `anon` y `authenticated`;
- se prueba que `anon` y usuario autenticado reciben denegación;
- se comprueba que ninguna página, Server Action o RPC depende de ella;
- su eliminación futura queda como migración separada y sólo se considera después de un ciclo de release sin consumidores.

### Funciones `SECURITY DEFINER`

Se construye un inventario versionado de cada función con definidor. Para cada una se decide uno de tres perfiles:

- cliente autenticado: `EXECUTE` sólo para `authenticated`/`service_role`, `search_path` fijo, nombres de objetos cualificados y validación interna de `auth.uid()`, rol y pertenencia;
- trabajo interno: `EXECUTE` sólo para `service_role` y sin ruta invocable por navegador;
- obsoleta: revocada para todos los roles de API y retirada posteriormente en un lote separado.

No habrá revocación masiva sin clasificación, porque algunas RPC de negocio son necesarias para checkout, inventario o comprobantes. Las 24 funciones con `search_path` mutable se corrigen primero si son `SECURITY DEFINER`; las restantes se agrupan después por dominio.

La protección de contraseñas filtradas es una configuración de Auth, no DDL. Se activa manualmente y se verifica en staging antes de producción. Los 242 hallazgos de performance se abordan después del P0, empezando por políticas duplicadas y foreign keys sin índice, con medición de planes y sin cambiar resultados de autorización.

## Fase 3: Storage compatible y con privilegio mínimo

### Estado y principio de compatibilidad

Producción tiene tres buckets públicos: `banners`, `products` y `payment_proofs`. Los objetos existentes no se mueven ni se descargan durante el cambio. Limitar uploads nuevos no altera la lectura de objetos históricos.

La transición separa dos conceptos:

- `banners` y `products` continúan públicos para lectura porque sus URLs forman parte del catálogo;
- `payment_proofs` termina privado, pero sólo después de que todos los escritores y lectores usen rutas canónicas y URLs firmadas.

### Límites de archivo

- `banners`: máximo 5 MiB; `image/jpeg`, `image/png` o `image/webp`.
- `products`: máximo 5 MiB; `image/jpeg`, `image/png` o `image/webp`.
- `payment_proofs`: máximo 5 MiB; `image/jpeg`, `image/png`, `image/webp` o `application/pdf`.

El nombre/extensión recibido del navegador no determina el tipo. Antes de emitir la autorización, el servidor valida el MIME declarado, la extensión permitida y el tamaño anunciado; el bucket vuelve a imponer MIME y tamaño al recibir el objeto. Después del upload y antes de finalizar la operación de negocio, el servidor verifica los metadatos almacenados y la firma real del contenido. Un objeto inválido no se referencia y se elimina por su ruta exacta. Los nombres canónicos usan UUID y nunca conservan un nombre de cliente ejecutable.

### Uploads mediante autorización de ruta

El navegador deja de tener permiso general de escritura. Una Server Action autenticada valida usuario y objeto de negocio y emite una autorización de upload de uso acotado para una ruta exacta. El navegador carga el archivo con esa autorización y llama una acción de finalización; la acción verifica que el objeto existe, cumple metadatos y pertenece al contexto antes de guardar la ruta.

Las rutas nuevas son:

- productos creados por clientes: `requests/<user-id>/<uuid>.<ext>`;
- imágenes administrativas de productos: `catalog/<inventory-id>/<uuid>.<ext>`;
- banners: `site/<uuid>.<ext>`;
- orden de stock: `orders/<user-id>/<order-id>/<uuid>.<ext>`;
- orden de importación: `imports/<user-id>/<import-order-id>/<uuid>.<ext>`;
- comisión: `commissions/<period-id>/<reporter-user-id>/<uuid>.<ext>`.

La autorización de productos/banners requiere administrador. La autorización de pedidos/importaciones exige que `auth.uid()` sea propietario de la orden y que su estado permita comprobante. La autorización de comisión exige un administrador de comisiones y período válido. Un objeto subido pero no finalizado se considera huérfano y sólo un trabajo interno acotado puede eliminarlo después de un período de gracia; nunca se infiere borrado por ausencia de una URL pública.

### Evolución aditiva de datos

Se agregan columnas anulables sin reemplazar las existentes:

- `orders.payment_proof_path`;
- `import_orders.payment_proof_path`;
- `commission_payments.proof_path`.

Los campos heredados `orders.payment_proof_url`, `import_orders.payment_proof_url` y `commission_payments.proof_url` permanecen. Los nuevos escritores guardan la ruta canónica y no generan nuevas URLs públicas. Los lectores prefieren la ruta y, si es nula, usan un adaptador de URL histórica.

La RPC `submit_order_payment_proof` recibe una ruta validada en la nueva versión; conserva una firma de compatibilidad durante un release para no romper el frontend anterior. La acción de importaciones y `recordCommissionPayment` adoptan la misma regla. Las notificaciones por correo enlazan a la página autenticada correspondiente, no a una URL pública ni a una URL firmada de larga duración.

### Lectura y backfill

Un resolver servidor autoriza propietario o administrador y crea una URL firmada de cinco minutos. Nunca devuelve una firma a `anon` ni inserta la firma en base de datos.

El backfill analiza únicamente los valores heredados de los tres campos URL, acepta sólo el host y bucket exactos de Crimson Crown, extrae una ruta normalizada y escribe la nueva columna si el objeto correspondiente existe. Filas con formato desconocido se reportan sin modificar. El backfill es idempotente, opera por lotes pequeños y registra conteos sin contenido personal.

### Secuencia de políticas

1. Publicar columnas, acciones, resolvers y lectores compatibles; buckets todavía públicos.
2. Convertir todos los uploads de `ProductForm`, importaciones administrativas, `HangOrderModal`, banners, órdenes, importaciones de usuario y comisiones a autorizaciones de ruta.
3. Verificar en local y staging que no exista `.storage.from(...).upload(...)` directo fuera del módulo autorizado.
4. Revocar `INSERT`, `UPDATE` y `DELETE` directos de `PUBLIC`/`anon`/`authenticated` sobre `products` y `banners`; conservar `SELECT` público.
5. Revocar escritura directa general sobre `payment_proofs`; mantener lectura pública durante la compatibilidad.
6. Ejecutar y verificar el backfill de rutas en staging; generar el reporte de excepciones.
7. Desplegar todos los lectores firmados y verificar órdenes, importaciones y comisiones históricas.
8. Marcar `payment_proofs` privado y revocar lectura pública sólo cuando el reporte de excepciones esté en cero o cada excepción tenga una ruta de compatibilidad aprobada.

Cada paso es una migración o despliegue independiente. Si falla, se restaura la política/código del paso anterior; no se borran objetos ni columnas.

## Fase 4: staging exclusivo y ensayo de release

El staging de Crimson se crea vacío y se prepara con esquema controlado. Los datos de prueba se obtienen de fixtures sintéticos y del proceso de sanitización local; no se sube el dump productivo crudo ni se copian correos, teléfonos, direcciones, tokens o comprobantes.

El ensayo incluye:

- reconstrucción del esquema y verificación del manifiesto de migraciones;
- usuarios sintéticos `anon`, estándar, admin y operador de comisiones;
- datos sintéticos de inventario, orden, importación, comisión y objetos Storage;
- aplicación exacta de cada fase en el mismo orden propuesto para producción;
- snapshot de esquema, grants, RLS, buckets y conteos antes/después;
- simulación de rollback operacional de cada fase;
- prueba de que Preview usa staging y que producción sigue apuntando a Crimson producción;
- bloqueo explícito de correos, cron y servicios externos.

No se considera staging válido si reutiliza un proyecto de otro producto o si su dataset contiene PII productiva no sanitizada.

## Estrategia de pruebas y gates

La implementación será test-first. Los gates mínimos son:

### Entornos

- tabla completa de URLs locales, productivas, staging sintéticas, extranjeras y malformadas;
- tests que demuestran que los errores no filtran claves ni URLs;
- escaneo del repositorio y configuración de release para referencias de proyectos ajenos;
- fallo deliberado de Preview antes de configurar staging Crimson.

### Migraciones

- manifiesto completo, sin duplicados y con hashes válidos;
- proyección temporal reproducible;
- `migration list` coherente y dry-run que muestra únicamente migraciones forward aprobadas;
- prueba negativa que reproduce `LegacyDbPushMissingLocalError` cuando se omite la proyección;
- SQL lint local y ensayo desde cero en staging.

### Base de datos y autorización

- matriz `anon`, usuario, admin y `service_role` para tablas, vista y RPCs tocadas;
- `admin_users` denegada a roles Data API;
- cada función con definidor tiene `search_path` fijo y grants explícitos;
- checkout, reserva/restauración de stock, créditos, importaciones y comisiones conservan resultados e idempotencia.

### Storage

- aceptación y rechazo por MIME, firma, tamaño, extensión y path traversal;
- usuario no puede emitir/finalizar upload para una orden ajena;
- usuario no puede leer comprobante ajeno ni enumerar el bucket;
- admin autorizado puede resolver comprobantes de los tres dominios;
- `anon` sólo lee catálogo/banners y no escribe ningún bucket;
- URL histórica válida se resuelve, URL de otro proyecto se rechaza y formato desconocido no se modifica;
- fallos entre upload y finalización no alteran estado de pago;
- pruebas de compatibilidad antes y después de volver privado el bucket.

### Aplicación

- pruebas focalizadas, matrices SQL/Storage, suite E2E, TypeScript, build y lint del lote;
- búsqueda estática de uploads directos y URLs públicas nuevas de comprobantes;
- smoke manual de admin, catálogo, checkout, perfil, importaciones y comisiones en staging;
- ninguna prueba se conecta a un host que no sea loopback o el staging Crimson explícito.

## Checkpoints y orden de implementación

1. Guard de entorno y tests fail-closed.
2. Manifiesto/proyección de release y reporte de equivalencias, sin escribir remoto.
3. Migraciones aditivas para paths y corrección focalizada de `admin_users`/funciones.
4. Frontera de uploads y lectores firmados en aplicación.
5. Matrices locales completas.
6. Creación/configuración de staging Crimson tras aprobar el costo.
7. Ensayo de todas las fases y rollback en staging.
8. Revisión manual del diff final, backup y runbook productivo.
9. Detención obligatoria antes de cualquier push, deploy, cambio de variables o migración productiva.

Después del P0 se retoma el backlog funcional en este orden: PIN/admin y responsive; Auth; filtros y accesos rápidos; Deckbuilder reimplementado desde lectura; operación/ESLint. SaaS permanece al final y Mercado Pago fuera de alcance.

## Criterios de aceptación del diseño

- Crimson no puede arrancar, compilar ni desplegar apuntando a El Perchero, Che Maracucho o una referencia Supabase arbitraria.
- El CLI de release no interpreta `migrations.enabled = false` como un dry-run válido.
- El historial remoto se representa sin revertir ni reaplicar migraciones históricas y sin modificar metadatos productivos.
- `admin_users` y las funciones con privilegios mínimos no exponen datos o ejecución a roles no autorizados.
- Ningún navegador conserva permiso general de escritura en Storage.
- Los comprobantes nuevos usan rutas; los históricos siguen accesibles durante la transición y sólo sus dueños/admin reciben URLs firmadas al final.
- No se mueven ni eliminan órdenes, usuarios, productos, inventario, comprobantes u objetos existentes.
- El staging pertenece exclusivamente a Crimson, contiene datos no productivos y reproduce la secuencia/rollback.
- La implementación se detiene con evidencia completa antes de cualquier cambio productivo.

## Riesgos residuales y mitigación

- **Equivalencia histórica incompleta:** se bloquea la proyección si falta evidencia o cambia un hash; la diferencia se convierte en SQL forward-only.
- **Frontend anterior durante el cierre de policies:** las revocaciones ocurren sólo después de desplegar y verificar todos los escritores nuevos.
- **URL histórica atípica:** el backfill no la toca; el bucket continúa público hasta resolver todas las excepciones.
- **Objeto huérfano:** la finalización es separada y verificable; una limpieza interna usa edad, prefijo y ausencia de referencia, nunca un borrado amplio.
- **Costo o demora de staging:** Preview/Development permanecen bloqueados; no se sustituye con producción ni con otro proyecto.
- **Funciones heredadas necesarias:** se clasifican por consumidor y se prueban antes de revocar grants.
- **Rollback de bucket privado:** se puede restaurar temporalmente lectura pública mientras se corrige el resolver, sin alterar objetos o filas.
