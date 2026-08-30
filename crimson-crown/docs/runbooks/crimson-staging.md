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

## Estado inicial

La vista previa está `ACTIVE_HEALTHY`, pero el estado de migraciones inicial es `MIGRATIONS_FAILED`. Esto no autoriza a ejecutar `db reset`, `migration repair` ni a copiar datos productivos. El desfase se resolverá mediante un baseline controlado y una proyección revisada antes de aplicar migraciones.

Hasta completar ese baseline:

- no enlazar Vercel Preview/Development;
- no sembrar usuarios ni registros;
- no ejecutar migraciones remotas;
- no modificar Production, Auth, Storage o variables de producción.

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
