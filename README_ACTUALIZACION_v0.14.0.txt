ONIC BUEN GOBIERNO · v0.14.0
CENTRO DE ALERTAS + COMPROMISOS / TAREAS
============================================================

BASE
----
Esta versión fue preparada sobre v0.13.3, que contiene la corrección
funcional del módulo Cortes de seguimiento.

INSTALACIÓN
-----------
1. Conserva una copia de la versión que actualmente funciona.
2. Ejecuta UNA SOLA VEZ en Supabase:

   sql/018_alertas_compromisos.sql

   No vuelvas a ejecutar 001–017.

3. Copia el contenido del parche v0.14.0 sobre la aplicación actual.
   El parche NO contiene js/config.js.
4. En el navegador realiza Ctrl + Shift + R.

QUÉ AGREGA
----------
- Nuevo módulo: Alertas y tareas.
- Resumen de alertas también visible en Inicio.
- Indicador numérico de alertas en el menú lateral.
- Alertas automáticas que se recalculan a partir de la información actual.
- Compromisos / tareas persistentes con responsable, prioridad y fecha límite.
- Conversión de una alerta en compromiso.
- Estados: Pendiente, En proceso, Completada y Cancelada.
- Resultado de cierre al completar una tarea.
- Ir a referencia desde alerta o compromiso.
- Historial automático de creación y cambios de compromisos.
- Control de edición simultánea mediante row_version.
- Integración de compromisos con copia de seguridad, restauración y
  eliminación forzada de Vigencia.

ALERTAS AUTOMÁTICAS INICIALES
-----------------------------
El Centro detecta actualmente:
- Programa activo sin Proyectos.
- Ponderación de Proyectos que no suma 100 %.
- Proyecto sin Actividades.
- Actividad vencida con cumplimiento pendiente.
- Actividad próxima a vencer en 15 días.
- Indicador sin línea base, meta o valor alcanzado.
- Indicador con meta igual a línea base.
- Actividad con avance técnico y sin Evidencias activas.
- Diferencia de 30 puntos o más entre avance técnico completo y ejecución
  presupuestal del Proyecto.
- Compromisos vencidos.
- Compromisos que vencen dentro de los próximos 3 días.

Las alertas NO modifican datos y NO se almacenan como registros permanentes.
Se recalculan cada vez que se actualiza el Centro. Cuando se corrige la causa,
la alerta desaparece. Si se necesita seguimiento formal, se convierte en
Compromiso.

ROLES
-----
Administrador / Coordinador:
- Consultan todas las alertas permitidas por la Vigencia.
- Crean compromisos generales o por Consejería.
- Asignan responsables.
- Actualizan, completan, cancelan y reabren compromisos.

Consejería:
- Ve alertas de sus Consejerías autorizadas.
- Puede crear y administrar compromisos dentro de esas Consejerías.
- No puede crear compromisos generales de toda la Vigencia.

Consulta:
- Puede consultar Alertas y Compromisos, sin modificarlos.

RESPALDOS
---------
Los compromisos se incluyen en la copia de seguridad de la Vigencia.
Al restaurar una copia, se conservan el contenido, responsable cuando el
usuario todavía existe, estado, prioridad, fechas y resultado de cierre.
Las referencias profundas restauradas se generalizan al nivel de Vigencia o
Consejería para evitar vínculos rotos con identificadores históricos.

IMPORTANTE
----------
Esta versión NO modifica las fórmulas de:
- avance técnico;
- cobertura de medición;
- ponderaciones;
- ejecución presupuestal;
- Cortes de seguimiento.

El Centro únicamente lee esas estructuras para generar alertas operativas.
