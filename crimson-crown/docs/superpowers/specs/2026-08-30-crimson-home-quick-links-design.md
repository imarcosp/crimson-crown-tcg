# Crimson Crown — accesos rápidos administrables en Home

## Objetivo

Mostrar bajo el carrusel de Home una colección administrable de accesos promocionales. El admin controla cantidad, orden, imagen o icono, etiqueta, URL y estado sin desplegar código.

## Modelo

`public.home_quick_links` contiene UUID, etiqueta, URL, imagen opcional, `icon_key` allowlisted, orden, activo y timestamps. La cantidad resulta de crear/eliminar registros; no existe un contador duplicado que pueda desincronizarse.

La lectura pública expone sólo filas activas. Los admins pueden leer y mutar todo mediante Server Actions autenticadas y RLS `is_admin()`. No se reutilizan credenciales ni datos de otros proyectos.

## URLs y recursos

- Se aceptan rutas internas con `/`, HTTPS externas y HTTP sólo en loopback para pruebas locales.
- Se rechazan URLs relativas ambiguas, `//`, `javascript:`, credenciales embebidas y protocolos desconocidos.
- Las imágenes usan tickets existentes del bucket público `banners`; la ruta es promocional y queda validada por tamaño, MIME y firma.
- Si no hay imagen se renderiza un icono Lucide elegido de una allowlist. La imagen tiene prioridad y el icono queda como fallback editable.

## UX

- La Home ordena por `display_order`, luego por creación, y no muestra el bloque si no hay activos.
- La grilla se adapta de una a cuatro columnas, sin overflow y con targets táctiles.
- El panel permite crear, editar, activar/desactivar y eliminar con confirmación; muestra una previsualización y estados de carga/error.

## Release

La migración es aditiva y no inserta datos por defecto, de modo que desplegarla no modifica la Home actual. Se promueve primero la tabla/políticas, luego el código. No toca productos, stock, órdenes, clientes ni movimientos.
