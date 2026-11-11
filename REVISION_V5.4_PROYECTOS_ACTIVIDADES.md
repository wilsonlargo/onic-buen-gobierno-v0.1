# ONIC Buen Gobierno · V5.4.2 · Proyectos / Actividades

## Objetivo
Permitir que cada Programa gestione dos tipos de unidad operativa al mismo nivel estratégico:

- **Proyecto**: conserva la estructura Proyecto → Actividades → Indicadores / Seguimiento / Evidencias / Presupuesto.
- **Actividad general**: se mide directamente y presenta Indicadores / Seguimiento / Evidencias / Presupuesto sin exigir una Actividad adicional visible para el usuario.

## Cambios principales
- El módulo se denomina **Proyectos / Actividades**.
- Botón **Agregar** con elección entre Proyecto y Actividad general.
- Filtros **Todos / Proyectos / Actividades generales**.
- Ponderaciones trata ambos tipos como unidades del Programa y conserva la regla de 100 %.
- Una Actividad general usa una actividad operativa interna para reutilizar el motor existente de indicadores, seguimiento, evidencia y presupuesto sin duplicar estructuras.
- El soporte operativo interno no aparece como una segunda Actividad en Mi trabajo ni en la búsqueda global.
- Control de calidad y Alertas distinguen Proyecto y Actividad general.
- Seguimiento de Mandatos usa el concepto **unidades vinculadas**.
- Inicio muestra **Unidades de gestión** y distingue Proyectos / Actividades generales.

## Conversión segura
### Proyecto → Actividad general
- Sin Actividades: crea automáticamente el soporte operativo.
- Con una Actividad: reutiliza íntegramente esa Actividad y conserva sus registros.
- Con más de una Actividad: bloquea la conversión. No modifica datos y exige consolidación asistida.

### Actividad general → Proyecto
La Actividad operativa se conserva y vuelve a mostrarse como Actividad normal del Proyecto. Indicadores, seguimientos, evidencias y presupuesto permanecen asociados.

## Protección de datos
- No se realizó conversión masiva.
- Todos los registros existentes quedaron inicialmente como **Proyecto**.
- La Consejería de Planeación, Administración y Finanzas de la Vigencia XI conserva sus 25 registros como Proyecto hasta que se clasifiquen manualmente.
- La copia de seguridad agrega metadatos para restaurar correctamente el tipo de unidad y la Actividad principal.
- Las copias antiguas siguen siendo compatibles y se restauran como Proyectos.

## Cambio de base de datos aplicado
Se añadieron a `proyectos`:
- `tipo_unidad` (`proyecto` / `actividad_general`), por defecto `proyecto`.
- `actividad_principal_id`, referencia opcional a la Actividad operativa principal.
- Índices de tipo y unicidad de la Actividad principal.

Archivo reproducible: `sql/020_proyectos_actividades_generales.sql`.

## Caso Planeación · Vigencia XI
Verificación posterior al cambio:
- 25 unidades existentes.
- 25 continúan como Proyecto.
- 0 Actividades generales.
- 0 actividades hijas.
- 0 Actividades principales asignadas.

La clasificación debe hacerse de forma deliberada, especialmente porque CPAF022 presenta una reclasificación histórica que no debe resolverse como duplicado automático.

## Comprobaciones técnicas
- Sintaxis de todos los módulos JavaScript.
- Importaciones locales verificadas.
- Referencias locales de `index.html` verificadas.
- CSS con llaves balanceadas.
- Recursos versionados con `v=5.4.0`.
