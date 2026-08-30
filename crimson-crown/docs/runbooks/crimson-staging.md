# Crimson Crown staging

## Identidad registrada

Este entorno pertenece exclusivamente a Crimson Crown. No se deben reutilizar proyectos, datos ni credenciales de El Perchero TCG o Che Maracucho.

| Campo | Valor |
| --- | --- |
| Organización | Marcos Perche (`kltduunmwmzxlmpaqzof`) |
| Proyecto padre | `djfqozfaqkqdoqeoqbzt` |
| Nombre de rama | `crimson-p0-staging` |
| Branch ID | `e15878e8-90d9-4a27-9df6-ee7bc3f8a81d` |
| Branch ref | `ssyeqgtdohwkcucedpwx` |
| Creada | `2026-08-29T17:40:39.514119+00:00` |
| Datos productivos copiados | No (`with_data=false`) |

La referencia de rama se registra aquí sólo como identidad no secreta. Las herramientas deben consumirla desde `CRIMSON_STAGING_SUPABASE_PROJECT_REF` y `NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF`; nunca deben usar este documento como configuración ejecutable.

## Costo y autorización

El costo vigente consultado para una rama fue **USD 0.01344 por hora**. El usuario confirmó ese costo antes de la creación de esta rama. No se infiere ni documenta ninguna proyección mensual o cargo adicional.

## Estado de migración controlada

La rama nació `ACTIVE_HEALTHY` y con estado de migraciones `MIGRATIONS_FAILED`: la historia legacy del repositorio no se podía reproducir de forma segura sobre una rama vacía. Ese estado **no** autorizó `db reset`, `migration repair`, una reproducción parcial de la historia ni la copia de datos productivos.

El `2026-08-30` se aplicó mediante el conector Supabase y contra el `project_id` exacto de esta rama:

1. un baseline DDL sin datos, tomado de `schema.sql`, con SHA-256 `B794231BAD902ACAE1AE8220A54E56C85F00422EE14E7898ECA0DA8664FB6EB3`;
2. las cinco migraciones compatibles que ya estaban en producción;
3. las seis migraciones forward P0 revisadas;
4. el hardening de los tres buckets y sus políticas, aplicado después como una migración separada y revisada.
5. la autorización sintética de comisiones exclusiva de staging, desde `scripts/staging/sql/scope-staging-commission-operator.sql` (SHA-256 `28CA719E8BA88C48F399FF9F9B0534BFF27928DF922CD2B6E77E6FC861DE73FF`).

El ledger remoto resultante contiene exactamente 14 entradas ordenadas: 1 baseline, 5 productivas, 6 forward, 1 de Storage y 1 `staging-only`. La última entrada es `20260830012837 / scope_staging_commission_operator / 4a9d1475cf9375ae02d009ddbddf4b9f290617c262e12e234a53ab59130fac9f`. Ese SQL permanece deliberadamente fuera de `supabase/migrations`: no pertenece al manifest ni a la cadena de producción. No se copiaron filas ni objetos desde producción y no se reescribió el historial legacy.

### Excepción a `supabase db push`

No se usa `supabase db push` para esta transición. La CLI compara timestamps locales con el ledger remoto; debido al baseline y al historial legacy fallido, un `db push` intentaría reconciliar dos historias que no son equivalentes y podría sugerir replay o reparación inseguros. Quedan prohibidos para este flujo:

- `supabase db push`;
- `supabase migration repair`;
- `supabase db reset`;
- DML remoto destructivo o una reaplicación de las 14 entradas existentes.

Si una revisión futura detecta un gap real, su aplicación será una operación separada y expresamente aprobada mediante el conector Supabase: `project_id` exacto `ssyeqgtdohwkcucedpwx`, SQL ya revisado y hash de fuente confirmado antes de la llamada. Después se vuelve a ejecutar la verificación read-only. El wrapper de ensayo nunca aplica ese SQL por sí mismo.

## Ensayo P0 read-only

`npm run staging:p0:verify` ejecuta `scripts/staging/run-p0-rehearsal.ps1` en modo `VerifyOnly`. Antes de crear cualquier proyección o cliente, valida la identidad exacta de staging, el guard de efectos externos y los hashes del baseline/migraciones. Después:

- enlaza sólo una proyección temporal al branch ref exacto;
- captura tres snapshots count-only (`before`, `after`, `rollback`);
- valida el orden y SHA-256 de las 14 entradas remotas, incluida la entrada `staging-only` separada;
- ejecuta los contratos privilegiados y la matriz de Storage exclusivamente contra el stack local;
- exige que los tres snapshots remotos sean idénticos y reporta `remoteMutations: 0`.

`-Mode Apply` está bloqueado salvo que también se indique `-ApplyToStaging`. Con el ledger completo actual, ese modo sólo devuelve `apply-authorized-noop` y sigue realizando cero mutaciones remotas. No existe un script npm de apply deliberadamente.

La evidencia JSON se guarda en `local-artifacts/release-evidence/staging-p0/`; contiene firmas, configuración no secreta de buckets y conteos agregados. No incluye filas, correos, URLs de comprobantes, paths de objetos ni datos personales.

## Variables obligatorias para pruebas futuras

El guard de staging exigirá, como mínimo:

- ambas referencias de staging iguales a `ssyeqgtdohwkcucedpwx`;
- `NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET=staging`;
- `DISABLE_EXTERNAL_SIDE_EFFECTS=true`;
- `CRIMSON_STAGING_EMAIL_DOMAIN=example.test`;
- un origen Preview no productivo;
- ausencia de credenciales Resend, Mercado Pago y webhooks.

No se registran claves, tokens, contraseñas ni cadenas de conexión en este runbook.

## Pausa, eliminación e incidentes

La pausa o eliminación de la rama será una operación manual separada, posterior a capturar la evidencia necesaria. Ante cualquier identidad discordante, variable de efectos externos o URL productiva, el proceso debe detenerse antes de crear un cliente o realizar una escritura.
