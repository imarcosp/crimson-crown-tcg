# Crimson Crown — diseño Admin/Auth

## Objetivo

Eliminar el PIN `1234` del navegador y completar los flujos locales verificables de registro, solicitud de recuperación y actualización real de contraseña sin reducir las fronteras de autorización existentes ni conectar pruebas con producción.

## Límites

- El acceso administrativo sigue requiriendo una sesión Supabase cuyo email esté autorizado por el proxy; las Server Actions y PostgreSQL vuelven a comprobar la autorización.
- No se crea ni modifica ninguna tabla, política, función o migración SQL.
- Los E2E usan únicamente `NEXT_PUBLIC_SUPABASE_URL` en loopback y `SUPABASE_SERVICE_ROLE_KEY` local. Cada usuario sintético se elimina aun si una aserción falla.
- El callback sólo redirige a destinos internos enumerados; nunca acepta una URL arbitraria.
- Google OAuth no se activa hasta disponer de cliente/secreto y redirect URIs exclusivos para Crimson local, staging y producción.

## Flujo administrativo

`/admin` deja de mostrar un PIN cliente. El layout renderiza navegación y contenido; el proxy continúa redirigiendo a usuarios anónimos o no autorizados. Los E2E deben demostrar acceso directo del admin y denegación del usuario estándar.

## Flujo PKCE

`/auth/callback` recibe `code` y un `next` permitido. Crea el cliente server-side dentro del request, ejecuta `exchangeCodeForSession(code)` y redirige sólo después de que la cookie de sesión fue escrita.

- Registro: `emailRedirectTo=/auth/callback?next=/`.
- Recuperación: `redirectTo=/auth/callback?next=/auth/update-password`.
- Código ausente o canje fallido: `/login?error=auth-callback`.

La página de actualización no vuelve a canjear el código. Exige una sesión de recuperación ya establecida, llama `updateUser({ password })`, cierra la sesión de recuperación al terminar y dirige al login para probar la nueva contraseña.

## Pruebas

- Contrato unitario del allowlist de callback.
- E2E: admin entra sin PIN; usuario estándar continúa bloqueado.
- E2E local: registro crea usuario/perfil y no llama servicios externos.
- E2E local: recuperación acepta la solicitud sin enumerar cuentas.
- E2E local: un enlace de recuperación sintético llega al callback, cambia la contraseña y permite iniciar sesión con la nueva clave.
- Gates: seguridad de entorno, TypeScript, lint focalizado, build y E2E completo.

## Google OAuth

El código sólo documentará el futuro flag y las redirect URIs. La activación exige credenciales distintas por entorno en Google Cloud y habilitar el provider correspondiente en cada Supabase de Crimson. No se reutilizan proyectos, secretos ni callbacks de El Perchero o Che Maracucho.
