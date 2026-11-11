# ONIC Buen Gobierno · V5.4.3 · Historial de avances

## Objetivo
Clarificar la diferencia entre el avance cuantitativo de los indicadores y el seguimiento cualitativo de la Actividad, haciendo visible y administrable el histórico de ambos.

## Cambios de experiencia
- Se elimina el botón global **Registrar avance** del encabezado de la Actividad. El avance se registra únicamente desde el indicador correspondiente.
- El encabezado mantiene **Registrar seguimiento**, destinado al seguimiento cualitativo general de la Actividad.
- El resumen superior incorpora **Registros de avance**, además de avance técnico, indicadores activos y evidencias activas.
- Cada indicador presenta las acciones **Registrar avance**, **Historial**, **Editar indicador** y eliminar indicador.
- Se retira la acción independiente **Nota** de la tarjeta del indicador para evitar confusión con el seguimiento cualitativo. La Auditoría continúa disponible en su módulo propio.
- El histórico cuantitativo se consulta por indicador y muestra fecha de corte, valor alcanzado y observación.
- Los registros de avance pueden editarse o eliminarse.
- El seguimiento cualitativo se presenta como **Bitácora de la actividad** y sus registros también pueden editarse o eliminarse.
- Los formularios explican explícitamente que el seguimiento cualitativo no modifica el porcentaje de avance técnico.

## Integridad de cálculo
No se modifica la fórmula del avance técnico. La base existente ya sincroniza `indicadores_actividad.valor_actual` cuando se inserta, actualiza o elimina un registro de `seguimientos_indicador`. Al eliminar el último corte, el indicador retorna a su línea base.

## Base de datos y permisos
No requiere migración nueva. Las tablas `seguimientos_indicador` y `seguimientos_actividad` ya cuentan con políticas de lectura, creación, actualización y eliminación para usuarios con permiso de escritura sobre la Actividad. Las operaciones continúan registrándose en el historial de auditoría existente.

## Compatibilidad
Se conserva la navegación **General | Avance | Evidencias**, la lógica de indicadores, ponderaciones, evidencias, presupuesto contextual y el resto de funciones de V5.4.2.
