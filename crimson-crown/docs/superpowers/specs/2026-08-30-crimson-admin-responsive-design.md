# Crimson Crown: hardening responsive administrativo

## Objetivo

Hacer que el panel existente sea operable en móvil y tablet sin rediseñar la marca, cambiar rutas ni alterar lógica de negocio.

## Decisión

- Mantener slate, rojo Crimson, tipografía y componentes actuales.
- En móvil, reemplazar el wrap de enlaces por un encabezado compacto con navegación colapsable y controles accesibles.
- En `md` o superior, conservar la navegación horizontal actual.
- El layout compartido limitará el ancho del contenido y evitará que tablas anchas empujen el documento.
- Las tablas conservarán todas sus columnas mediante scroll horizontal dentro de su propio contenedor; no se ocultará información operativa.
- Los formularios y modales usarán ancho disponible, altura máxima y scroll vertical interno cuando el viewport sea pequeño.

## No objetivos

- No cambiar navegación primaria, nombres de rutas, permisos, datos ni Server Actions.
- No introducir una librería de componentes o animaciones nueva.
- No convertir tablas en tarjetas ni redefinir la identidad visual.

## Criterios de aceptación

- A 390 px existe un control accesible para abrir/cerrar la navegación administrativa.
- A 768 px se muestra la navegación horizontal y desaparece el control móvil.
- Las rutas administrativas representativas no generan overflow horizontal del documento a 390 px ni 768 px.
- Tablas anchas desplazan su propio contenedor y los modales quedan dentro del viewport.
- Acceso admin/usuario estándar y flujos funcionales existentes continúan verdes.
