ONIC Buen Gobierno · Hotfix v0.13.2

Corrige de forma robusta la acción + Nuevo corte.

Cambios:
- El manejador de clic se registra inmediatamente al renderizar el módulo.
- Al hacer clic se consulta directamente la Vigencia visible en el selector.
- El botón no depende del orden de finalización de las consultas de carga.
- El estado disabled se remueve explícitamente cuando existe una Vigencia.
- El botón activo usa estilo verde primario para diferenciarlo claramente de un botón deshabilitado.
- Versionado de recursos v0.13.2 para evitar caché del navegador.

No requiere SQL adicional.

Instalación:
1. Copiar el contenido del parche sobre v0.13.1 (o sobre v0.13.0 si ya tiene la migración 017 ejecutada).
2. No reemplazar js/config.js.
3. Recarga forzada: Ctrl + Shift + R.
