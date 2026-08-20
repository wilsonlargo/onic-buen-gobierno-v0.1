ONIC BUEN GOBIERNO · HOTFIX v0.13.3

CAUSA CORREGIDA
El círculo decorativo del encabezado (.hero-panel::after) estaba situado sobre
los controles ubicados en el extremo derecho del panel. Aunque el botón
“+ Nuevo corte” estuviera habilitado, esa capa podía capturar el clic.

CORRECCIÓN
- El elemento decorativo deja de recibir eventos del puntero.
- El contenido real del encabezado queda por encima de la decoración.
- No se modifica la lógica de Cortes ni los permisos.
- No requiere ejecutar SQL.

INSTALACIÓN
1. Sustituir index.html y css/styles.css con los archivos del hotfix.
2. Sustituir js/app.js para forzar la carga de la versión actual del módulo.
3. Ctrl + Shift + R.

PRUEBA
En Cortes, seleccionar una Vigencia y pulsar “+ Nuevo corte”.
Debe abrirse el formulario “Nuevo corte de seguimiento”.
