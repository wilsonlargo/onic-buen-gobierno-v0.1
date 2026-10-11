ONIC BUEN GOBIERNO · V5.1 AUDITADA

Base: ONIC ESTABLE V5(1)

Cambios principales:
- Eliminación del antiguo módulo LaTeX no utilizado.
- Eliminación de archivos históricos que no forman parte de la aplicación desplegable.
- Mensajes de error de usuario depurados para no mostrar detalles internos de programación.
- Versionado interno de recursos unificado en 5.1.0 para evitar mezclas de caché.
- Fondo de acceso optimizado para reducir el peso de carga en móvil.
- Revisión de todas las importaciones y sintaxis JavaScript.
- Auditoría de Supabase, RLS, funciones, integridad y rendimiento.

Esta versión NO requiere SQL para ejecutarse con la base actual.

Se entrega adicionalmente 019_auditoria_seguridad_optimizacion.sql como mejora
recomendada de seguridad/rendimiento. Ese archivo NO fue aplicado automáticamente
a la base de producción.

Después de sustituir la aplicación, hacer una recarga forzada:
Ctrl + Shift + R
