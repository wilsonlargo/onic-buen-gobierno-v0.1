# ONIC Buen Gobierno · V5.4.5 · Importaciones estandarizadas

## Objetivo
Unificar la experiencia de importación de la jerarquía operativa para que **Líneas de Acción**, **Programas** y **Proyectos / Actividades** utilicen el mismo patrón visual y de interacción.

## Líneas de Acción
- Modal de importación ancho (`wide`).
- Contexto de Vigencia y Consejería visible al inicio.
- Pegado desde Excel/Google Sheets con validación automática.
- Lectura automática al seleccionar CSV, XLSX o XLS.
- Eliminados los botones intermedios **Previsualizar** y **Leer archivo**.
- Encabezados y reglas en panel desplegable.
- Vista previa con filas válidas, errores y advertencias.
- Diagnóstico explícito de nombres duplicados, orden incompatible y estado no reconocido.

## Programas
- Mismo patrón visual y funcional que Líneas y Proyectos.
- Contexto de Vigencia, Consejería y Línea destino.
- Pegado y lectura de archivos automáticos.
- Vista previa y reglas plegables.
- Diagnóstico explícito de nombres duplicados, orden incompatible y estado no reconocido.

## Correcciones automáticas informadas
- `orden` vacío: se usa `0`.
- `orden` no numérico: se usa `0` y se muestra advertencia con el valor recibido.
- Estado vacío: se usa el estado activo por defecto.
- Estado no reconocido: se usa el estado activo y se muestra una advertencia con el valor recibido.
- En Programas se siguen aceptando variantes femeninas (`activa`, `inactiva`, `archivada`) y se normalizan a los valores internos masculinos.

## Interfaz
- Reutilización de los estilos de importación asistida de V5.4.4.
- Tabla de vista previa compacta con scroll propio.
- Acciones inferiores fijas dentro del modal.
- Caché de recursos actualizada a `v=5.4.5`.

## Base de datos
No se modifica el esquema, RLS ni las tablas. Continúan utilizándose:
- `lineas_accion`
- `programas`

## Compatibilidad
La lógica de creación, permisos, auditoría y ponderaciones no fue reemplazada. Los cambios se concentran en el flujo de importación y en la claridad de la validación previa.
