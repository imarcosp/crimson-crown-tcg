# Operación local — snapshot, backup y recuperación

## Alcance y límites

Este flujo opera únicamente sobre el contenedor exacto `supabase_db_crimson-crown`. No acepta una URL, un proyecto enlazado ni credenciales remotas. Los artefactos se escriben fuera de Git bajo `%LOCALAPPDATA%\CrimsonCrown\supabase-mirror` (o `CRIMSON_LOCAL_ARTIFACT_ROOT`, sujeto al mismo validador).

El backup contiene datos de la réplica local, incluidos hashes de autenticación y datos productivos replicados. Debe tratarse como restringido aunque nunca salga del equipo. No incluye los bytes de objetos de Storage; el mirror actual usa únicamente objetos sintéticos para pruebas y esos objetos se reconstruyen con sus fixtures.

## Preflight obligatorio

1. Confirmar que el worktree corresponde a Crimson y que `git status --short` no contiene artefactos.
2. Ejecutar `npm run local-db:assert-network` y exigir PASS.
3. Confirmar que Supabase local está activo y que la aplicación usa `.env.test.local`.
4. No usar `supabase link`, `db push`, una URL PostgreSQL ni el proyecto remoto en este flujo.

## Snapshot sin valores de filas

```powershell
npm run local-db:snapshot
```

El resultado externo incluye firmas de relaciones y funciones, migraciones, grants, policies, buckets, conteos y una clasificación explícita por objeto. No contiene valores de filas. Si aparece una tabla nueva sin clasificación, el comando falla antes de escribir el snapshot.

Clasificaciones:

- `public_catalog` / `public_content`: información publicable.
- `operational_metadata` / `internal_operational`: configuración y trazabilidad interna.
- `restricted_identity`, `restricted_personal`, `restricted_commerce`, `restricted_financial`, `restricted_access`, `restricted_storage`: artefactos restringidos que nunca deben entrar al repositorio.

Cada JSON tiene un sidecar `.sha256` en el mismo directorio.

## Crear y verificar un backup local

```powershell
npm run local-db:backup
npm run local-db:verify-backup -- --backup "C:\Users\<usuario>\AppData\Local\CrimsonCrown\supabase-mirror\raw\local-backup-AAAAMMDD-HHMMSSZ.dump"
```

La verificación exige que el archivo esté dentro del directorio externo `raw`, valida su SHA-256, crea una base temporal `crimson_restore_verify_<pid>`, restaura allí y comprueba conteos estructurales. La base temporal se elimina en `finally`; la base operativa `postgres` no se limpia ni reemplaza.

Un archivo no se considera recuperable hasta que esta verificación termina en PASS.

## Recuperación

La recuperación de la réplica operativa es un procedimiento manual y excepcional:

1. Detener el servidor Next local y conservar el dump/hash anterior como evidencia.
2. Verificar nuevamente el backup en la base temporal.
3. Crear un stack Supabase local de reemplazo con volumen nuevo y la misma versión de PostgreSQL; no ejecutar `pg_restore --clean` sobre el stack operativo.
4. Restaurar el dump verificado en el stack de reemplazo usando el rol administrador local.
5. Comparar snapshot, migraciones y conteos con el manifiesto del backup.
6. Ejecutar seguridad, TypeScript, build y E2E contra el reemplazo.
7. Cambiar el entorno local al stack recuperado sólo después del PASS; conservar el volumen anterior hasta la revisión manual.

Si falta el sidecar, el hash no coincide, cambia la versión mayor de PostgreSQL o falla una función/extensión, se abandona el restore y se conserva intacta la réplica operativa.

## Producción

Estos scripts no crean ni restauran backups productivos. Antes de cualquier promoción, producción requiere un backup administrado y recuperable de Supabase, snapshot previo/posterior, dry-run de migraciones, revisión manual y aprobación explícita. Ningún dump productivo se guarda en Git.
