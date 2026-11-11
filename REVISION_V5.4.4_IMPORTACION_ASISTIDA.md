# ONIC Buen Gobierno · V5.4.4 · Importación asistida

## Objetivo
Pulir el diálogo **Importar Proyectos / Actividades**, reducir pasos innecesarios y resolver de forma comprensible los errores de compatibilidad de fechas al importar desde Excel, CSV o una tabla copiada.

## Interfaz
- El diálogo de importación usa ahora un modal ancho (`wide`) para aprovechar mejor la pantalla.
- Se evita el scroll horizontal de toda la ventana; la tabla de previsualización conserva su propio desplazamiento cuando lo necesita.
- **Pegar tabla** valida automáticamente al pegar o editar; se elimina el botón adicional “Previsualizar”.
- **Cargar archivo** lee el CSV/XLS/XLSX inmediatamente al seleccionarlo; se elimina el botón adicional “Leer archivo”.
- El selector nativo de archivo se reemplaza visualmente por un área clara de selección que muestra el nombre del archivo.
- Los encabezados y formatos aceptados pasan a un bloque desplegable para reducir ruido visual.
- La vista previa incorpora columnas de **Inicio** y **Cierre** y mantiene el botón final de importación habilitado solo cuando existen filas válidas.

## Fechas y diagnóstico
El problema anterior era que los valores procedentes de Excel se convertían directamente a texto visible y se enviaban/comparaban sin normalización consistente.

Ahora el importador:
- lee XLS/XLSX conservando los valores reales de las celdas (`raw: true`);
- reconoce fechas seriales de Excel;
- reconoce `AAAA-MM-DD`, `AAAA/MM/DD`, `DD/MM/AAAA`, `DD-MM-AAAA`, fechas con hora y nombres de mes frecuentes en español/inglés;
- normaliza toda fecha válida al formato interno `AAAA-MM-DD`;
- valida que la fecha exista realmente (por ejemplo, rechaza `31/02/2026`);
- valida que el cierre no sea anterior al inicio;
- detecta errores visibles de Excel como `#VALUE!`, `#NUM!`, `#N/A` y `#####`;
- no interpreta un año aislado como `2026` como si fuera un serial de Excel.

## Corrección asistida
Cuando una fecha no puede interpretarse:
- la fila muestra el **valor original recibido**;
- explica el problema de manera concreta;
- permite seleccionar una fecha válida directamente en la vista previa; o
- permite **Dejar sin fecha** cuando el dato realmente no aplica.

La fila se vuelve a validar inmediatamente después de la corrección. No es necesario borrar toda la columna del archivo original.

## Compatibilidad
- No se modifican tablas ni políticas de Supabase.
- No se altera la lógica de creación de Proyectos / Actividades generales ni la asociación con Mandatos.
- Se actualiza el cache-busting de recursos a `v=5.4.4` para evitar servir archivos antiguos del navegador.
