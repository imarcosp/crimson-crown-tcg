# Plan — operación local y calidad de Crimson

1. Definir contratos puros para clasificar tablas y construir snapshots sin valores de filas.
2. Generar inventario de esquema, conteos y clasificación en el directorio externo validado.
3. Crear un backup lógico local con hash y verificarlo restaurándolo en una base temporal desechable.
4. Documentar backup, verificación, restauración y recuperación sin incluir artefactos en Git.
5. Medir ESLint, corregir automáticamente sólo reglas mecánicas seguras y establecer un gate de no regresión por regla.
6. Integrar contratos al gate de entorno, ejecutar regresión y cerrar un commit aislado sin producción.
