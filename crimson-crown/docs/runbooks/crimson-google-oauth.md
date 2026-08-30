# Crimson Crown — preparación de Google OAuth

Google OAuth permanece deshabilitado hasta contar con credenciales propias de Crimson Crown. Este runbook no contiene secretos y no autoriza reutilizar Google Cloud, Supabase ni callbacks de El Perchero o Che Maracucho.

## Separación obligatoria

Cada entorno debe tener su propio cliente OAuth o, como mínimo, credenciales y redirect URIs explícitamente inventariados:

- local: Supabase local `http://127.0.0.1:54621`;
- staging: Supabase `ssyeqgtdohwkcucedpwx` y el dominio staging exacto de Crimson;
- producción: Supabase `djfqozfaqkqdoqeoqbzt` y `https://www.crimsoncrownimports.com`.

El callback autorizado en Google Cloud es el callback Auth de cada Supabase (`/auth/v1/callback`), no una ruta de otro proyecto. El redirect de regreso a la aplicación debe terminar en `/auth/callback?next=/` y estar incluido en la allowlist Auth del entorno correspondiente.

## Activación futura

1. Crear/seleccionar un proyecto Google Cloud exclusivo de Crimson y configurar la pantalla de consentimiento.
2. Registrar los callbacks Supabase exactos, sin comodines amplios.
3. Guardar client ID/secret únicamente en la configuración segura del Supabase correspondiente; nunca en Git ni en variables públicas.
4. Habilitar el provider primero en local, luego staging y finalmente producción.
5. Mostrar el botón de Google sólo cuando `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` en ese entorno.
6. Ejecutar un E2E PKCE en staging y confirmar que `/auth/callback` canjea el código, crea/encuentra el perfil y redirige a `/`.
7. Antes de producción, comprobar que Preview/Development no apuntan a Supabase productivo y revisar manualmente la pantalla de consentimiento/dominio.

## Criterio de bloqueo

Sin client ID, secret, consentimiento y redirect URIs propios de Crimson, la UI no debe ofrecer Google. Email/contraseña, registro y recuperación continúan funcionando de forma independiente.
