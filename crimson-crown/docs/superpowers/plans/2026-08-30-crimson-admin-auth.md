# Crimson Crown Admin/Auth — plan de implementación

## Alcance

Implementar el diseño `docs/superpowers/specs/2026-08-30-crimson-admin-auth-design.md` mediante cambios pequeños y test-first. No contiene SQL ni operaciones remotas.

### Tarea 1: retirar el PIN

1. Cambiar el E2E administrativo para exigir que el panel sea visible inmediatamente después de una sesión admin y que no exista el formulario de PIN.
2. Ejecutar la prueba focalizada y comprobar RED.
3. Simplificar `src/app/admin/layout.tsx` a navegación/contenido.
4. Actualizar helpers E2E locales y de staging que todavía ingresan `1234`.
5. Ejecutar el E2E focalizado y comprobar GREEN.

### Tarea 2: callback PKCE seguro

1. Crear pruebas unitarias RED para destinos permitidos, destinos externos y valores malformados.
2. Implementar un helper puro de allowlist Auth.
3. Cambiar `/auth/callback` para canjear el código con el cliente server-side creado dentro del request.
4. Cambiar registro y recuperación para enviar destinos distintos.
5. Simplificar `/auth/update-password` para consumir la sesión ya canjeada, actualizar la clave, cerrar la sesión de recuperación y volver al login.

### Tarea 3: E2E Auth local

1. Añadir un spec serial con guard explícito de loopback y cliente admin local.
2. Probar registro y limpiar usuario/perfil sintético.
3. Probar solicitud de recuperación sin inspeccionar contenido sensible de correo.
4. Generar un enlace de recuperación sintético local, recorrer callback/actualización e iniciar sesión con la nueva contraseña.
5. Ejecutar el spec focalizado dos veces para probar limpieza/idempotencia.

### Tarea 4: gates y checkpoint

1. Ejecutar seguridad de entorno, pruebas unitarias Auth y TypeScript.
2. Ejecutar build y E2E completo.
3. Ejecutar lint focalizado y distinguir deuda preexistente.
4. Actualizar backlog con resultados reales y dejar un checkpoint limpio listo para revisión manual.
