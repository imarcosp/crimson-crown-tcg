# Crimson Crown: base productiva segura y esqueleto reutilizable

**Estado:** aprobado por el usuario el 2026-08-14.

## Objetivo

Optimizar Crimson Crown como aplicación productiva single-tenant, construir un entorno local fiel y seguro para pruebas, y dejar límites de arquitectura que permitan reutilizar el producto en despliegues white-label independientes. El SaaS multi-tenant compartido queda fuera del alcance actual.

## Restricciones absolutas

- No crear commits ni hacer push.
- No ejecutar SQL, migraciones, seeds, resets o despliegues contra producción.
- No ejecutar Playwright, pruebas destructivas ni scripts de mantenimiento contra `https://www.crimsoncrownimports.com` o el proyecto Supabase `djfqozfaqkqdoqeoqbzt`.
- No perder ni modificar inventario, clientes, órdenes, créditos, buylist, importaciones, pagos o archivos productivos.
- El proyecto de referencia `D:\El Perchero\el-perchero-tcg` permanece estrictamente read-only.
- Ningún dump, backup, dato personal o secreto puede entrar al workspace `D:\crimson-crown-tcg\crimson-crown`, al Git worktree `D:\crimson-crown-tcg` o a Git.
- Toda la comunicación funcional y de producto permanece en español.

## Decisión de producto

Crimson Crown seguirá siendo single-tenant. La reutilización futura se implementará inicialmente como múltiples despliegues aislados del mismo código:

```text
mismo producto
|- Crimson Crown -> Supabase Crimson + configuración Crimson
|- Tienda A      -> Supabase Tienda A + configuración Tienda A
`- Tienda B      -> Supabase Tienda B + configuración Tienda B
```

Cada tienda tendrá su propia base, Auth, Storage, secretos y dominio. No se agregarán ahora `tenant_id`, memberships cross-tenant, resolución multi-dominio dentro de una base ni RLS compartida entre tiendas.

## Preparación white-label permitida ahora

- Centralizar branding, contactos, pagos, redes, logos, fuentes, colores y textos.
- Mantener Crimson Crown como configuración predeterminada sin cambiar su comportamiento público.
- Separar contratos de inventario, pricing, email, pagos, branding y fuentes externas.
- Versionar el esquema Supabase y generar tipos, manteniendo un único store por despliegue.
- Crear feature flags globales y configuración por entorno.
- Eliminar hardcodes solo cuando el módulo correspondiente sea intervenido por una necesidad prioritaria.

## Réplica local

La réplica tendrá dos estados claramente separados:

1. **Snapshot crudo temporal:** backup productivo cifrado o dump lógico de solo lectura, almacenado fuera del repositorio y nunca expuesto a la aplicación.
2. **Réplica local persistente sanitizada:** conserva estructura, UUID, relaciones, cantidades, estados, precios y distribución funcional, pero sustituye PII, credenciales, tokens y documentos privados.

La fuente preferida es un backup ya generado por Supabase. Si no existe un backup descargable, se aceptará una conexión PostgreSQL temporal con los permisos mínimos que permitan `pg_dump`, utilizada en horario de baja actividad.

## Datos conservados y sustituidos

Se conservan:

- catálogo, variantes, condiciones, finishes, sets y precios;
- inventario, stock, cantidades y movimientos existentes;
- relaciones entre clientes, órdenes, líneas, créditos, importaciones y buylist;
- UUID, fechas, estados y distribuciones necesarias para reproducir comportamiento;
- configuración no secreta necesaria para pruebas.

Se sustituyen o excluyen:

- nombres, emails, teléfonos, direcciones y notas con información personal;
- hashes de contraseña, sesiones, identidades OAuth y tokens;
- claves API, secretos, webhooks y credenciales de proveedores;
- comprobantes de pago y archivos privados, reemplazados por fixtures;
- destinatarios reales de email y referencias capaces de disparar side effects externos.

## Usuario administrador local

La réplica creará `admin.local@crimson.test` mediante el servicio Auth local. Tendrá una contraseña generada para pruebas y un perfil con el rol administrativo que resulte del esquema real. No existirá en producción y no reutilizará ninguna credencial productiva.

También se crearán fixtures separados para cliente, staff y usuario sin privilegios cuando la autorización local esté reproducida.

## Barreras de seguridad

- El repositorio no se enlazará al proyecto productivo mediante `supabase link`.
- Los comandos de trabajo usarán `--local` o una ruta de backup explícita.
- Un guard abortará si detecta el ref `djfqozfaqkqdoqeoqbzt`, sus hosts Supabase o `crimsoncrownimports.com` en un entorno de pruebas.
- `.env.test.local` apuntará únicamente al rango local reservado para Crimson Crown, con API en `127.0.0.1:54621` y PostgreSQL en `127.0.0.1:54622`.
- Email, pagos y APIs externas estarán deshabilitados o simulados.
- El stack local solo será apto para recibir datos derivados de producción cuando una prueba activa confirme que los servicios responden por loopback, el bridge dedicado conserva el binding `127.0.0.1` y IPv6 deshabilitado, y las reglas de firewall limitadas a `54620-54629` están habilitadas, bloqueando el acceso no-loopback y asociadas a `com.docker.backend.exe` cuando corresponde. No se usa un probe desde el contenedor hacia el host como prueba de firewall externo porque Docker Desktop puede enrutarlo fuera del trayecto filtrado por Windows Firewall.
- Todo artefacto crudo residirá fuera del workspace y tendrá hash, permisos restringidos y política de eliminación.

## Flujo de trabajo

1. Verificar CLI, Docker, proyecto fuente y ausencia de link remoto.
2. Adquirir schema/backup en modo lectura sin imprimir secretos.
3. Restaurar el snapshot crudo en una instancia local aislada.
4. Inventariar tablas, columnas, policies, funciones, grants, buckets y volúmenes.
5. Escribir un manifiesto de clasificación basado en el esquema real.
6. Sanitizar dentro de una transacción local.
7. Verificar que no queden emails, teléfonos, URLs, tokens o comprobantes productivos.
8. Crear el admin local y fixtures de roles.
9. Conectar la aplicación exclusivamente a Supabase local.
10. Ejecutar pruebas de integridad, RLS y smoke sin side effects externos.

## Criterios de aceptación

- Producción no recibe escrituras y conserva sus conteos y estado.
- No hay repositorio enlazado a Supabase productivo.
- Ningún secreto o dump aparece en `git status` ni dentro del workspace.
- La réplica conserva los conteos y relaciones funcionales acordados.
- Cero emails, teléfonos, direcciones, credenciales o documentos privados reales superan los detectores de sanitización.
- El admin local puede iniciar sesión y acceder al panel local.
- La aplicación y Playwright abortan antes de conectarse a un host productivo.
- El entorno local puede destruirse y reconstruirse sin tocar ningún recurso remoto.

## Fuera de alcance

- SaaS multi-tenant compartido.
- Cambios de producción, deploys, commits o pushes.
- Copia persistente de PII productiva.
- Sincronización continua o replicación lógica desde producción.
- Ejecución de proveedores reales de pagos, correo o importación durante E2E.
