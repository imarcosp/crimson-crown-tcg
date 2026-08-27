# Crimson Crown: inventarios independientes y catálogo híbrido

**Estado:** diseño aprobado por el usuario el 2026-08-26.

## Objetivo

Permitir que Crimson Crown administre múltiples inventarios independientes sin alterar la continuidad del inventario actual. Los inventarios secundarios podrán coexistir, participar del catálogo cuando estén activos y conservar su trazabilidad completa en ventas, cancelaciones, devoluciones y métricas.

La implementación de este diseño se realizará primero en el entorno local de Crimson Crown. No incluye escrituras, migraciones aplicadas, despliegues ni cambios en Vercel o Supabase remoto.

## Restricciones de producto

- El inventario actual se convierte en **Inventario Principal**.
- El inventario principal siempre existe, permanece activo y no se puede eliminar.
- Los inventarios secundarios son independientes: nunca se fusionan físicamente con otro inventario.
- Desactivar un inventario lo excluye de nuevas ventas, pero conserva sus productos, órdenes y métricas.
- Un inventario con historial se archiva en lugar de eliminarse físicamente.
- La eliminación definitiva solo se permite si no existen stock, órdenes, movimientos ni referencias históricas.
- Todo precio automático usa Card Kingdom y TCGplayer como fallback, igual que el flujo actual.
- Los precios manuales son independientes por inventario.
- Toda asignación de stock debe conservar el inventario de origen.
- Todo trabajo queda limitado al repositorio `D:\crimson-crown-tcg\crimson-crown`.

## Decisión arquitectónica

Se usará una tabla central de productos con `inventory_id`, no tablas o esquemas separados por inventario.

```text
inventories
|- Principal
|  `- products (inventory_id = principal)
|- Inventario Japón
|  `- products (inventory_id = japon)
`- Inventario Colección
   `- products (inventory_id = coleccion)
```

Esta opción conserva los UUID y relaciones actuales, reduce la superficie de migración y permite que el catálogo agrupe variantes mediante una clave lógica sin mezclar las filas físicas.

## Modelo de datos

### `inventories`

Campos nuevos:

- `id uuid primary key`.
- `name text not null`.
- `description text`.
- `location_label text`: ubicación física opcional, por ejemplo `Estante B2`.
- `kind text`: `primary` o `secondary`.
- `is_active boolean not null default true`.
- `created_at timestamptz not null default now()`.
- `updated_at timestamptz not null default now()`.
- `archived_at timestamptz`.

Restricciones:

- Solo puede existir un registro con `kind = 'primary'`.
- El principal no puede cambiar a secundario, desactivarse ni archivarse.
- El nombre debe ser único entre inventarios no archivados.

### `products`

Campos nuevos:

- `inventory_id uuid not null references inventories(id)`.
- `variant_key text not null`.

La clave única operativa será `(inventory_id, variant_key)`. Las consultas de fusión, edición y carga CSV deberán incluir siempre `inventory_id`.

El precio, stock, imágenes y metadatos continuarán viviendo en cada fila de producto. No se copiarán precios ni stock entre inventarios.

### `order_items`

Campos nuevos:

- `inventory_id uuid not null references inventories(id)`.
- `variant_key text`.
- `source_inventory_name text` como snapshot de auditoría para mantener una lectura histórica clara.

El `product_id` existente seguirá identificando la fila de `products` que suministró la línea; `inventory_id`, `variant_key` y `source_inventory_name` harán explícito y auditable su origen.

Durante la transición, las órdenes antiguas se asociarán al Inventario Principal. Las órdenes nuevas registrarán una línea por combinación de producto, inventario y precio.

### `inventory_stock_movements`

Tabla de auditoría para entradas, reservas, ventas, liberaciones, cancelaciones, devoluciones y ajustes manuales:

- `id uuid primary key`.
- `inventory_id uuid not null`.
- `product_id uuid`.
- `order_id uuid`.
- `order_item_id uuid`.
- `quantity_delta integer not null`.
- `movement_type text not null`.
- `notes text`.
- `created_by uuid`.
- `created_at timestamptz not null default now()`.

Los movimientos vinculados a órdenes tendrán una clave idempotente para impedir que una repetición de cancelación o reembolso duplique stock.

## Identidad exacta de una variante

`variant_key` se calculará de forma determinista y normalizada. No incluirá precio, stock, imagen, inventario ni fecha.

Para Magic se usará principalmente:

- `scryfall_id`.
- Estado.
- Idioma.
- Acabado.

Para productos sin `scryfall_id` se usará:

- TCG.
- Nombre normalizado.
- Edición normalizada.
- Número de colección.
- Estado.
- Idioma.
- Acabado.

La normalización recortará espacios, unificará mayúsculas/minúsculas y aplicará los valores canónicos de acabado ya usados por el proyecto. La clave se generará en servidor para que CSV, formulario, catálogo y checkout compartan la misma definición.

Una variante idéntica en dos inventarios tendrá dos filas de `products` con la misma `variant_key` y distinto `inventory_id`.

## Precio y presentación en catálogo

Cada oferta tendrá una fuente:

- **Automático — Card Kingdom**.
- **Automático — TCGplayer** cuando Card Kingdom no tenga precio.
- **Manual** cuando `is_manual_price = true`.

Los scripts de precios actualizarán productos automáticos de todos los inventarios y no modificarán precios manuales.

El catálogo devolverá una vista híbrida agrupada por `variant_key`:

- Suma el stock de inventarios activos.
- Excluye inventarios inactivos y archivados.
- Agrupa ofertas automáticas con el mismo precio efectivo.
- Muestra ofertas manuales o precios diferentes como versiones diferenciadas.
- Conserva la prioridad de compra del Inventario Principal.

El cliente verá una carta única con disponibilidad total y, cuando corresponda, un desglose visual de precio automático, fallback o manual. El nombre del inventario se reserva para la operación administrativa, salvo que una pantalla de producto necesite aclarar que existen ofertas distintas.

## Flujo de checkout híbrido

El carrito migrará gradualmente desde el `product_id` actual hacia `variant_key` y cantidad. Los carritos heredados se resolverán contra su producto actual, asociado al Inventario Principal.

La RPC transaccional de checkout deberá:

1. Validar usuario, cantidad, variante e inventarios activos.
2. Resolver nuevamente precios en servidor.
3. Bloquear todas las filas elegibles en un orden estable.
4. Consumir primero la fila del Inventario Principal.
5. Continuar por inventarios secundarios activos hasta completar la cantidad.
6. Fallar toda la operación si no existe stock suficiente.
7. Crear una línea de `order_items` por producto/inventario utilizado.
8. Guardar el precio aplicado, la variante y el snapshot del inventario.
9. Registrar los movimientos de reserva o venta.

Si una compra usa una unidad del principal y dos de un secundario, la orden tendrá dos líneas internas aunque el cliente haya agregado una sola carta híbrida al carrito.

## Cancelaciones, devoluciones y eliminación parcial

Las acciones que hoy actualizan estado y restauran stock por separado deberán converger en operaciones atómicas:

- Cancelación con reposición.
- Expiración automática de pago.
- Reembolso con reposición.
- Eliminación parcial de una línea de orden.
- Reposición manual autorizada.

Cada operación bloqueará la orden y sus líneas, verificará que la reposición todavía no se haya ejecutado y creará un movimiento compensatorio por el `inventory_id` de origen.

Una orden antigua sin origen explícito se tratará como proveniente del Inventario Principal. Una orden nueva nunca dependerá de que el producto siga visible en catálogo para conocer dónde devolverlo.

## Administración

Se agregará una pantalla `/admin/inventories` con:

- Tarjetas de inventario.
- Selector de inventario activo.
- Creación y edición de nombre, descripción y ubicación física.
- Activación y desactivación con confirmación.
- Acceso al inventario, movimientos y métricas.
- Diagnóstico previo a eliminación.

`/admin/inventory` conservará el flujo actual, pero quedará limitado al inventario seleccionado. El formulario manual y el CSV recibirán el inventario como contexto obligatorio.

La eliminación mostrará stock, órdenes activas, historial y movimientos. Si existe cualquier referencia histórica, la acción disponible será archivar.

## Detalle administrativo de una orden

En `/admin/orders/[id]`, cada línea mostrará una etiqueta visible:

```text
Sale de: Inventario Principal
Sale de: Inventario Japón · Estante B2
```

La etiqueta usará el snapshot guardado y no dependerá de que el inventario siga activo. Si la misma carta se asignó desde dos inventarios, se mostrarán líneas separadas con sus cantidades y precios correspondientes.

Las órdenes antiguas mostrarán `Inventario Principal (orden histórica)` cuando no tengan todavía una referencia explícita.

## Métricas por inventario

Las métricas se calcularán desde `order_items` y `inventory_stock_movements`, nunca desde el total global de `orders`.

Indicadores:

- Stock actual.
- Variantes y unidades disponibles.
- Valuación del stock.
- Unidades vendidas.
- Ventas brutas.
- Ventas netas.
- Cancelaciones y devoluciones.
- Ticket promedio por línea.
- Entradas y ajustes.

Los descuentos y créditos aplicados a nivel de orden se distribuirán proporcionalmente entre sus líneas por valor bruto, con ajuste de centavos en la última línea. De esta forma, la suma de métricas por inventario coincide con el total de la orden.

## Seguridad y permisos

- Solo administradores podrán gestionar inventarios y movimientos manuales.
- El catálogo público solo consultará productos de inventarios activos con stock disponible.
- Las RPC críticas validarán permisos internamente y no confiarán en valores enviados por el navegador.
- Las operaciones de checkout, cancelación, reposición y eliminación serán atómicas e idempotentes.
- La eliminación de un inventario se ejecutará mediante una función segura que vuelva a verificar todas las referencias.
- No se habilitarán escrituras directas desde el cliente para movimientos, asignaciones o restauraciones de stock.

## Backlog de implementación

### P0 — Base de datos e identidad

1. Crear migración local de `inventories` y registrar el Inventario Principal.
2. Asociar productos actuales al principal.
3. Agregar `variant_key` e índices de búsqueda.
4. Agregar columnas de origen a `order_items`.
5. Crear `inventory_stock_movements` y restricciones de idempotencia.
6. Crear políticas RLS y RPCs administrativas.

### P0 — Carga y catálogo

7. Actualizar formulario manual y CSV con contexto de inventario.
8. Impedir fusiones entre inventarios.
9. Actualizar scripts de precios para respetar la fuente manual.
10. Crear consulta híbrida para catálogo y búsqueda.
11. Actualizar tarjeta, detalle, carrito y persistencia heredada.
12. Mostrar ofertas automáticas, fallback y manuales de forma diferenciada.

### P0 — Checkout y órdenes

13. Implementar asignación principal/secundarios con locks.
14. Registrar líneas y movimientos por origen.
15. Reemplazar restauraciones directas por operaciones idempotentes.
16. Cubrir cancelación, expiración, devolución y eliminación parcial.
17. Mostrar inventario de origen en `/admin/orders/[id]`.

### P1 — Operación y métricas

18. Crear `/admin/inventories`.
19. Agregar activar, desactivar, archivar y eliminar con diagnóstico.
20. Crear dashboard por inventario.
21. Agregar filtros de movimientos y órdenes.
22. Incorporar ubicación física opcional.

### P1 — Verificación

23. Tests de aislamiento de datos.
24. Tests de variantes idénticas y variantes diferentes.
25. Tests de precios automáticos, fallback y manuales.
26. Tests de asignación híbrida y sobreventa concurrente.
27. Tests de cancelación, reembolso, expiración y reposición idempotente.
28. Tests de eliminación segura y archivado.
29. Tests de RLS y permisos admin.
30. E2E de creación, activación, compra híbrida, detalle de orden y métricas.
31. Ejecutar typecheck, build y suite local sin conexiones remotas.

## Criterios de aceptación

- El inventario actual sigue siendo visible y operativo como principal.
- Dos inventarios pueden tener la misma variante sin fusionarse.
- El catálogo suma stock solo de inventarios activos.
- El checkout consume principal antes que secundarios.
- Cada línea de orden identifica su inventario de origen.
- Cancelaciones y devoluciones restituyen stock en el inventario correcto.
- Repetir una reposición no duplica stock.
- Un inventario histórico se archiva y conserva métricas.
- El inventario principal no se puede eliminar ni desactivar.
- Los precios automáticos respetan Card Kingdom → TCGplayer.
- Los precios manuales permanecen independientes.
- `/admin/orders/[id]` muestra dónde localizar cada carta.
- Las métricas por inventario suman correctamente frente al total global.
- Los tests locales no realizan escrituras contra Vercel ni Supabase remoto.

## Resumen para el cliente

Crimson Crown podrá trabajar con varios inventarios separados. El inventario actual seguirá siendo el principal y tendrá prioridad en las ventas.

Cuando la misma carta exista en distintos inventarios con la misma edición, idioma, estado y acabado, el cliente verá una sola carta con el stock total disponible. El sistema utilizará primero las unidades del inventario principal y luego las de los inventarios secundarios.

Aunque el catálogo sea híbrido, los inventarios nunca se mezclan internamente. Cada venta guardará de qué inventario salió cada unidad. Por eso, si una orden se cancela, se devuelve o se modifica, el producto vuelve exactamente al inventario original.

Los precios automáticos seguirán usando Card Kingdom y, cuando no exista precio allí, TCGplayer. Los precios cargados manualmente serán independientes por inventario y se mostrarán como ofertas diferenciadas.

El administrador podrá crear, activar, desactivar, archivar y eliminar inventarios secundarios bajo reglas de seguridad. También podrá ver stock, movimientos, ventas, cancelaciones y valuación de cada inventario por separado.

Dentro del detalle administrativo de cada orden, cada carta indicará claramente si sale del Inventario Principal o de un inventario secundario, incluyendo la ubicación física opcional. Esto permitirá encontrar las cartas rápidamente al preparar el pedido.

## Fuera de alcance de esta fase

- Escrituras o migraciones aplicadas en Supabase remoto.
- Deploys, cambios de variables o acciones en Vercel.
- Transferencias automáticas entre inventarios.
- Multi-tenant o separación entre tiendas.
- Reglas de precio dinámico distintas de Card Kingdom, TCGplayer y precio manual.
