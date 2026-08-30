# Transición segura de comprobantes de pago

Fecha de preparación: 2026-08-29.

Este runbook preserva órdenes, importaciones, comisiones, URLs históricas y objetos. El proyecto productivo autorizado es únicamente Crimson Crown (`djfqozfaqkqdoqeoqbzt`). El script de ensayo de este repositorio es deliberadamente **local-only**: no se modifica su guard para conectarlo a staging o producción.

## Invariantes y parada obligatoria

- Nunca borrar, renombrar ni mover objetos de `payment_proofs` durante esta transición.
- Nunca borrar, volver `NOT NULL` ni sobrescribir `orders.payment_proof_url`, `import_orders.payment_proof_url` o `commission_payments.proof_url`.
- El backfill sólo puede rellenar `payment_proof_path`/`proof_path` cuando estén en `NULL`, la URL heredada siga siendo idéntica y el objeto exacto exista.
- Una URL de otro proyecto, una URL firmada, una ruta que no pertenezca al registro o un formato desconocido es una excepción; no se corrige por inferencia.
- `products` y `banners` siguen públicos para lectura. `payment_proofs` se vuelve privado manualmente en la fase 8 y nunca antes.
- Una URL firmada dura cinco minutos, se crea después de autorizar propietario/admin y nunca se persiste.
- Ante identidad, permisos, red, respuesta Storage o conteos no verificables: detenerse. Un `401`, `403`, `5xx` o error de red no equivale a objeto ausente.

## Evidencia vigente, no reutilizable como aprobación

El preflight productivo de sólo lectura del 2026-08-29 observó 25 referencias legacy de órdenes, 0 de importaciones y 1 de comisión. Las 26 coincidían con el patrón estricto, sus 26 objetos distintos existían y no se observaron objetos duplicados o no referenciados. Esta evidencia envejece: todas las consultas de preflight deben repetirse inmediatamente antes del backfill y otra vez antes de volver privado el bucket.

## Ensayo local obligatorio

Desde la raíz del worktree de Crimson, con `.env.test.local` generado desde el stack local exacto:

```powershell
node --test scripts/local-db/payment-proof-backfill.test.mjs
node scripts/local-db/payment-proof-backfill.mjs
node scripts/local-db/payment-proof-backfill.mjs --apply
node scripts/local-db/payment-proof-backfill.mjs --apply
```

El script verifica antes de crear el cliente:

- API exacta `http://127.0.0.1:54621/`;
- contenedores `supabase_kong_crimson-crown` y `supabase_db_crimson-crown` activos;
- puertos publicados `54621`/`54622`;
- labels Compose/Supabase `crimson-crown`;
- workdir Docker exacto `D:\crimson-crown-tcg\crimson-crown`.

Sin `--apply` sólo informa. Con `--apply` procesa como máximo 50 candidatos por lote y hace compare-and-set sobre columna path nula más URL legacy sin cambios. La segunda ejecución debe mostrar `resolvable: 0`; los ya rellenados pasan a `alreadyPathed`. La salida permitida es:

```json
{
  "scanned": 0,
  "resolvable": 0,
  "missingObject": 0,
  "foreignUrl": 0,
  "invalidFormat": 0,
  "alreadyPathed": 0
}
```

Los valores dependen del fixture. Las excepciones sólo incluyen dominio, motivo y fragmento opaco de ocho caracteres; nunca URL, firma, correo, nombre ni otra PII.

## Consultas exactas de preflight y postflight

Ejecutar estas consultas en el editor SQL del proyecto cuya identidad haya sido revisada visualmente. Son de sólo lectura. Guardar resultados con timestamp y project ref en el dossier del release.

### 1. Estado de columnas y hashes inmutables legacy

```sql
with legacy_state as (
  select 'orders'::text as domain, count(*) filter (where payment_proof_url is not null) as legacy_count,
    count(*) filter (where payment_proof_path is not null) as path_count,
    md5(coalesce((jsonb_agg(jsonb_build_array(id::text, payment_proof_url) order by id::text)
      filter (where payment_proof_url is not null))::text, '[]')) as legacy_hash
  from public.orders
  union all
  select 'imports', count(*) filter (where payment_proof_url is not null),
    count(*) filter (where payment_proof_path is not null),
    md5(coalesce((jsonb_agg(jsonb_build_array(id::text, payment_proof_url) order by id)
      filter (where payment_proof_url is not null))::text, '[]'))
  from public.import_orders
  union all
  select 'commissions', count(*) filter (where proof_url is not null),
    count(*) filter (where proof_path is not null),
    md5(coalesce((jsonb_agg(jsonb_build_array(id::text, proof_url) order by id::text)
      filter (where proof_url is not null))::text, '[]'))
  from public.commission_payments
)
select * from legacy_state order by domain;
```

El `legacy_count` y `legacy_hash` de cada dominio deben ser idénticos antes y después. El cambio permitido es sólo el aumento esperado de `path_count`.

### 2. Referencias estrictas y existencia exacta

```sql
with strict_refs as (
  select 'order'::text as domain, o.id::text as record_id,
    substring(o.payment_proof_url from
      '^https://djfqozfaqkqdoqeoqbzt[.]supabase[.]co/storage/v1/object/public/payment_proofs/(stock_' ||
      o.id::text || '_[0-9]{13}[.](?:jpg|jpeg|png|webp|pdf))$') as object_path
  from public.orders o
  where o.payment_proof_url is not null and o.payment_proof_path is null
  union all
  select 'import', io.id::text,
    substring(io.payment_proof_url from
      '^https://djfqozfaqkqdoqeoqbzt[.]supabase[.]co/storage/v1/object/public/payment_proofs/(import_' ||
      io.id::text || '_[0-9]{13}[.](?:jpg|jpeg|png|webp|pdf))$')
  from public.import_orders io
  where io.payment_proof_url is not null and io.payment_proof_path is null
  union all
  select 'commission', cp.id::text,
    substring(cp.proof_url from
      '^https://djfqozfaqkqdoqeoqbzt[.]supabase[.]co/storage/v1/object/public/payment_proofs/(commission-payments/' ||
      cper.period_key || '/[0-9]{13}-[a-zA-Z0-9._-]+[.](?:jpg|jpeg|png|webp|pdf))$')
  from public.commission_payments cp
  join public.commission_periods cper on cper.id = cp.period_id
  where cp.proof_url is not null and cp.proof_path is null
), checked as (
  select r.*, count(so.id) as object_matches
  from strict_refs r
  left join storage.objects so
    on so.bucket_id = 'payment_proofs' and so.name = r.object_path
  group by r.domain, r.record_id, r.object_path
)
select domain,
  count(*) as scanned,
  count(*) filter (where object_path is not null and object_matches = 1) as resolvable,
  count(*) filter (where object_path is null) as invalid_format,
  count(*) filter (where object_path is not null and object_matches = 0) as missing_object,
  count(*) filter (where object_matches > 1) as duplicate_object
from checked
group by domain
order by domain;
```

Antes de la fase 8, `invalid_format`, `missing_object` y `duplicate_object` deben ser cero o cada fila debe tener una compatibilidad explícita, revisada y documentada.

### 3. Reporte de excepciones sin PII

```sql
with strict_refs as (
  select 'order'::text as domain, o.id::text as record_id,
    substring(o.payment_proof_url from
      '^https://djfqozfaqkqdoqeoqbzt[.]supabase[.]co/storage/v1/object/public/payment_proofs/(stock_' ||
      o.id::text || '_[0-9]{13}[.](?:jpg|jpeg|png|webp|pdf))$') as object_path
  from public.orders o where o.payment_proof_url is not null and o.payment_proof_path is null
  union all
  select 'import', io.id::text,
    substring(io.payment_proof_url from
      '^https://djfqozfaqkqdoqeoqbzt[.]supabase[.]co/storage/v1/object/public/payment_proofs/(import_' ||
      io.id::text || '_[0-9]{13}[.](?:jpg|jpeg|png|webp|pdf))$')
  from public.import_orders io where io.payment_proof_url is not null and io.payment_proof_path is null
  union all
  select 'commission', cp.id::text,
    substring(cp.proof_url from
      '^https://djfqozfaqkqdoqeoqbzt[.]supabase[.]co/storage/v1/object/public/payment_proofs/(commission-payments/' ||
      cper.period_key || '/[0-9]{13}-[a-zA-Z0-9._-]+[.](?:jpg|jpeg|png|webp|pdf))$')
  from public.commission_payments cp
  join public.commission_periods cper on cper.id = cp.period_id
  where cp.proof_url is not null and cp.proof_path is null
)
select domain, left(replace(record_id, '-', ''), 8) as id_fragment,
  case
    when object_path is null then 'invalidFormat'
    when not exists (
      select 1 from storage.objects so
      where so.bucket_id = 'payment_proofs' and so.name = strict_refs.object_path
    ) then 'missingObject'
  end as reason
from strict_refs
where object_path is null or not exists (
  select 1 from storage.objects so
  where so.bucket_id = 'payment_proofs' and so.name = strict_refs.object_path
)
order by domain, id_fragment;
```

### 4. Bucket y policies

```sql
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('products', 'banners', 'payment_proofs')
order by id;

select policyname, cmd, roles
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;
```

Postflight final esperado: `products`/`banners` públicos; `payment_proofs` privado; los tres con límite `5242880`; ningún rol Data API con escritura general.

## Ocho fases de promoción

Cada fase es un checkpoint independiente. En staging se ensaya en este orden. En producción se requiere backup recuperable, evidencia de staging, diff aprobado y revisión manual antes de cada mutación.

1. **Compatibilidad aditiva.** Aplicar columnas anulables, acciones, finalizadores y resolvers. Mantener los tres buckets públicos. Confirmar que ningún DDL toca filas de negocio o columnas legacy.
2. **Escritores por ticket.** Desplegar todos los uploads de productos, solicitud de importación, banners, comprobantes de órdenes/importaciones y comisiones mediante autorización de ruta exacta y `upsert: false`.
3. **Scan de callsites.** Verificar que no exista `.storage.from(...).upload(...)` directo fuera de `upload-client.ts`, ni `getPublicUrl()` nuevo para `payment_proofs`.
4. **Cerrar escritura de catálogo.** Revocar `INSERT`/`UPDATE`/`DELETE` directo para roles de navegador en `products` y `banners`; conservar lectura pública y probar imágenes existentes.
5. **Cerrar escritura de comprobantes.** Revocar escritura general en `payment_proofs`, todavía público para lectura durante la ventana de compatibilidad.
6. **Backfill controlado.** En staging, generar reporte, rellenar únicamente paths nulos con objeto exacto y CAS, repetir hasta obtener cero actualizaciones y guardar hashes legacy. El script local sirve como ensayo y no se conecta a remoto. La ejecución remota requiere un artefacto operador separado, revisado y vinculado explícitamente a Crimson; nunca se elimina su guard para reutilizar el script local.
7. **Lectores firmados.** Desplegar y probar dueño/admin en órdenes, importaciones y comisiones históricas. Confirmar denegación cross-owner/`anon`, vencimiento de cinco minutos y que ninguna firma queda en base de datos, logs o correo.
8. **Privacidad productiva manual y última.** Repetir todas las consultas, resolver excepciones y tomar backup. Sólo con reporte limpio o compatibilidad documentada, cambiar manualmente `payment_proofs` a privado y retirar `SELECT` público. Hacer smoke inmediato de los tres dominios. Esta fase no se automatiza junto al deploy.

## Rollback operacional no destructivo

- Si falla una fase 1–3, volver al release de aplicación anterior; las columnas nuevas y URLs/objetos permanecen.
- Si falla una fase 4–5, restaurar temporalmente las policies exactas del checkpoint anterior y corregir los escritores. No restaurar permisos más amplios que los que existían en ese checkpoint.
- Si falla el backfill, detener nuevos lotes. Conservar paths ya verificados: son aditivos e idempotentes. Investigar excepciones; no poner paths en `NULL`, no tocar URLs legacy y no borrar objetos.
- Si falla un lector firmado, volver a la versión compatible path-first/legacy-fallback. Mantener el bucket público hasta que el lector esté corregido.
- Si falla después de la fase 8, restaurar temporalmente lectura pública de `payment_proofs` y volver a la versión compatible mientras se corrige. No revertir datos ni objetos.

La transición termina sólo cuando hashes legacy, conteos, políticas, pruebas de acceso y smoke manual quedan anexados al dossier de release. La retirada futura de columnas URL u objetos históricos pertenece a otro backlog y requiere una autorización separada.
