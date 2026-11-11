# ONIC Buen Gobierno · V5.4.2 · Avance simplificado

## Objetivo
Simplificar la experiencia de seguimiento de toda Actividad, tanto dentro de un Proyecto como cuando funciona como Actividad general.

## Cambios funcionales
- La navegación de Actividades queda en **General | Avance | Evidencias**.
- **Presupuesto** solo aparece si la Actividad está marcada con financiación o ya conserva rubros presupuestales.
- **Avance** integra en una sola pantalla:
  - indicadores y avance técnico;
  - botón principal **Registrar avance**;
  - creación/edición de indicadores;
  - seguimiento cualitativo de logros, dificultades y próximos pasos;
  - histórico de valores de indicadores.
- Si hay varios indicadores activos, **Registrar avance** permite escoger cuál actualizar.
- Si no hay indicadores activos, la interfaz explica que primero debe crearse uno.
- Las Actividades dentro de Proyecto incorporan la opción **Tiene financiación / maneja presupuesto**.
- Las Actividades generales continúan usando la financiación definida en su perfil.
- Si existen rubros históricos, Presupuesto permanece visible aunque se desactive la financiación, evitando ocultar información registrada.
- Las tarjetas y encabezados de Actividad omiten métricas financieras cuando no aplican.
- Enlaces internos que antes abrían Indicadores o Seguimiento ahora llevan a **Avance**.

## Base de datos
Se agregó `actividades.tiene_financiacion boolean not null default false`.
Las Actividades que ya tenían rubros fueron marcadas automáticamente con financiación para preservar su comportamiento.
La migración reproducible está en `sql/021_financiacion_actividad_y_avance.sql`.

## Compatibilidad
La lógica de cálculo de indicadores, avance técnico, ponderaciones, evidencias y seguimiento no fue reemplazada. Solo se reorganizó la interacción de usuario.
