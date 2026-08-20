ONIC BUEN GOBIERNO
Actualización v0.12.1 - Exportación del Planeador

Esta actualización agrega exportación directa del Planeador del Proyecto en:
- PDF
- Excel (.xlsx)

NO REQUIERE SQL.
No ejecute nuevamente las migraciones anteriores.

FUNCIONAMIENTO
1. Abra un Proyecto.
2. Ingrese a la pestaña Planeador.
3. Seleccione Vista matriz o Vista cronograma.
4. Si usa Vista cronograma, seleccione Mensual o Trimestral.
5. Pulse PDF o Excel.

La exportación respeta la vista actualmente seleccionada.

VISTA MATRIZ
Incluye:
- Proyecto, Vigencia, Consejería, Línea de Acción y Programa.
- Duración, número de Actividades, cobertura técnica y avance técnico.
- Código y nombre de la Actividad.
- Responsable.
- Fecha de inicio y cierre.
- Estado temporal.
- Avance técnico.
- Cantidad de Indicadores.
- Cantidad de Evidencias activas.
- Presupuesto programado.
- Color del Planeador en Excel.

VISTA CRONOGRAMA
Incluye:
- Escala mensual o trimestral seleccionada.
- Actividades distribuidas sobre la línea de tiempo.
- Colores del Planeador.
- Avance técnico dentro del periodo programado.
- Referencia HOY cuando la fecha actual está dentro del periodo.

En PDF, los cronogramas extensos se distribuyen en bloques para mantener la legibilidad.
En Excel, el cronograma se mantiene como una matriz horizontal desplazable y editable.

HISTORIAL
Cada exportación queda registrada como "Exportó Planeador", indicando:
- formato: PDF o Excel;
- vista: Matriz o Cronograma;
- escala: Mensual o Trimestral cuando corresponda.

INSTALACIÓN RECOMENDADA
Use el parche v0.12.1 sobre la versión v0.12.0.
El parche no incluye js/config.js.

Después de copiar los archivos, realice una recarga forzada:
Ctrl + Shift + R

La actualización incorpora versionado v0.12.1 de los recursos para reducir problemas de caché.
