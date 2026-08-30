# Release seguro — accesos rápidos de Home

## Artefactos

- Migración: `20260830170000_create_home_quick_links.sql`.
- Código consumidor: Home, Server Actions y `/admin/quick-links`.
- Storage: reutiliza tickets firmados `kind: 'banner'`; no modifica buckets, políticas ni objetos existentes.

La migración crea únicamente `public.home_quick_links`, su índice parcial, grants y políticas RLS. No contiene DML y no referencia productos, stock, órdenes, perfiles, inventarios ni movimientos.

## Evidencia local

- Conteos inmediatamente antes y después de aplicar la migración: productos 1.840, stock 2.147, órdenes 58, perfiles 77 y movimientos 52; todos idénticos.
- Matriz RLS: anónimo y usuario estándar sólo ven filas activas; el usuario estándar no puede insertar, actualizar ni eliminar; el admin sí puede administrar.
- CRUD E2E: crear, editar, mostrar en Home, desactivar, ocultar y eliminar con limpieza final.
- Tras la suite integral final: productos 1.840, stock 2.147, órdenes 58, perfiles 77, inventarios 2 y cero accesos, órdenes o ítems sintéticos residuales. Los movimientos adicionales observados pertenecen a ejecuciones explícitas del fixture de checkout, no a esta migración.
- `supabase db lint`: cero errores de esquema.

## Orden obligatorio

1. Capturar en producción los conteos de `orders`, `profiles`, `products`, suma de `products.stock`, `inventories`, `inventory_stock_movements`, objetos de Storage y confirmar que `home_quick_links` aún no existe.
2. Aplicar primero la migración `20260830170000` mediante la proyección controlada del proyecto Crimson. No usar `db reset`, `migration repair` ni replay de migraciones históricas.
3. Verificar tabla, índice, grants, políticas y que todos los conteos operativos y objetos de Storage permanezcan idénticos.
4. Promover el código y ejecutar smoke de Home y `/admin/quick-links` con una sesión admin real.
5. Crear contenido únicamente después del smoke. La tabla nace vacía, por lo que la portada no cambia por la migración o el deployment.
6. Repetir los conteos operativos. La única diferencia autorizada después de usar el panel son las filas creadas explícitamente en `home_quick_links` y, si se subió una imagen, el nuevo objeto promocional dentro de `banners/site/`.

## Rollback

Ante un problema, revertir primero el deployment. La tabla vacía o con contenido puede permanecer sin afectar el runtime anterior. No eliminar la tabla ni objetos de Storage durante un incidente. Eliminar un registro desde el panel no borra automáticamente su archivo para evitar pérdida accidental de recursos compartidos.
