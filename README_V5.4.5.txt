ONIC Buen Gobierno · V5.4.5 · Importaciones estandarizadas

Base: V5.4.4 Importación asistida.

Esta versión extiende el patrón de importación asistida a las secciones de Líneas de Acción y Programas.

Cambios principales:
- Modal ancho y consistente con Proyectos / Actividades.
- Pegar tabla valida y previsualiza automáticamente.
- Seleccionar CSV/XLSX/XLS lee el archivo automáticamente; se elimina el paso "Leer archivo".
- Instrucciones y encabezados aceptados quedan en un bloque desplegable.
- Vista previa con resumen de filas válidas, filas con error y advertencias.
- Mensajes claros sobre duplicados, orden incompatible y estado no reconocido.
- El nombre del archivo seleccionado permanece visible.
- La tabla de revisión usa desplazamiento interno y no fuerza scroll horizontal de todo el modal.
- No hay cambios de esquema ni migraciones de Supabase.

Compatibilidad:
- Se conserva la lógica de guardado existente de lineas_accion y programas.
- V5.4.4 permanece como respaldo.
