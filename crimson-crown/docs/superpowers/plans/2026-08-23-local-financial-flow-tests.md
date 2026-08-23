# Pruebas financieras locales y reserva de stock

## Objetivo

Validar el checkout actual contra la réplica local de Supabase sin ejecutar pagos
reales, tocar producción ni dejar fixtures persistentes. El primer lote cubre la
normalización del método de entrega que envía la interfaz, la validación de
direcciones y la reserva/liberación de stock.

## Alcance del lote

1. Probar con datos sintéticos que `pickup`, `moto` y `shipping` se distinguen
   aunque la interfaz añada la etiqueta del medio de pago.
2. Rechazar checkout con dirección incompleta para métodos que requieren envío.
3. Verificar que `decrement_stock` es atómico, no permite stock negativo y puede
   restaurarse en la limpieza local.
4. Verificar el endpoint de liberación de órdenes vencidas sólo con órdenes
   sintéticas Mercado Pago y Supabase local; no invocar ningún proveedor externo.
5. Ejecutar la matriz existente de seguridad, almacenamiento y E2E y documentar
   cualquier riesgo que requiera diseño separado (webhook, transacciones
   multi-tabla y proveedor de pagos).

## Fuera de alcance

- No se ejecutan compras reales ni se configuran credenciales de Mercado Pago.
- No se cambia el esquema remoto ni se hace `db push` a producción.
- No se implementa todavía un webhook ni el SaaS futuro.

## Criterios de salida

- Las pruebas locales sólo aceptan hosts loopback y limpian todos sus fixtures.
- El checkout interpreta correctamente los métodos que llegan con el sufijo de
  pago y exige dirección para `moto`/`shipping`.
- El endpoint cron no queda abierto en un entorno no loopback.
- No hay cambios sin verificar antes de proponer el commit del lote.
