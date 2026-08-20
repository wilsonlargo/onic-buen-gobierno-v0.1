ONIC · SISTEMA DE BUEN GOBIERNO
v0.15.0 · Seguimiento de Mandatos

BASE
- Esta versión parte de v0.14.0, que ya contiene Cortes, Alertas y Compromisos.

INSTALACIÓN
1. Conserva una copia de la versión que actualmente funciona.
2. Copia el contenido del parche v0.15.0 sobre la aplicación actual.
3. No reemplaces js/config.js.
4. No es necesario ejecutar una migración SQL.
5. Realiza una recarga forzada del navegador: Ctrl + Shift + R.

NUEVA FUNCIÓN
- Nuevo módulo "Seguimiento de Mandatos".
- Selección por Vigencia y Consejería.
- Filtros por estado, vinculación y medición.
- Consolidación de Proyectos relacionados con cada Mandato.
- Avance asociado y cobertura de medición derivados de los Proyectos.
- Detalle de Proyectos por Consejería, Línea y Programa.
- Navegación directa desde el Mandato al Proyecto.
- Acceso a Notas de Auditoría sobre cada Mandato.

CRITERIO DE CÁLCULO
- El avance asociado de un Mandato no es un porcentaje manual.
- Se deriva del avance técnico acreditado de sus Proyectos vinculados.
- Cuando hay Proyectos en Programas distintos, cada Proyecto participa de forma equivalente en la lectura del Mandato.
- Esto evita mezclar ponderaciones que solo son válidas dentro de cada Programa.
- La cobertura del Mandato es el promedio de la cobertura de medición de los Proyectos vinculados que participan en el cálculo activo.
- El resultado se presenta como "avance asociado" y no como cumplimiento integral del Mandato.

NO SE MODIFICA
- Fórmula de avance técnico de Indicadores, Actividades, Proyectos, Programas, Líneas, Consejerías o Vigencia.
- Ponderaciones.
- Presupuesto.
- Cortes.
- Alertas y Compromisos.
- Usuarios, roles e Historial.
