# ONIC Buen Gobierno — v0.10.0 · Ponderaciones por Consejería

Nueva sección independiente **Ponderaciones**.

## Instalación

1. Ejecutar una sola vez en Supabase:

```text
sql/014_ponderaciones_consejeria.sql
```

No volver a ejecutar 001–013.

2. Reemplazar:

```text
index.html
css/styles.css
js/app.js
js/modules/proyectos.js
js/modules/proyectoWorkspace.js
```

3. Agregar:

```text
js/modules/ponderaciones.js
```

No reemplazar `js/config.js`. Después usar `Ctrl + Shift + R`.

## Funcionamiento

- Selección Vigencia → Consejería.
- Muestra Línea → Programa → Proyecto en una sola pantalla.
- Líneas y Programas conservan ponderación automática.
- Los Proyectos son editables.
- Los cambios son borrador y NO se guardan durante la edición.
- **Ponderación sugerida** distribuye equitativamente el 100 % dentro de cada Programa.
- **Completar restante** ayuda a cerrar el porcentaje faltante.
- **Restablecer** recupera los valores oficialmente guardados.
- Cada Programa debe sumar exactamente 100 %.
- La aprobación exige una **Descripción / criterio de la ponderación**.
- Solo **Aprobar ponderación** actualiza la base de datos. La actualización se hace en una transacción SQL.
- Se registra fecha, usuario, descripción y snapshot de cada aprobación.
- Las aprobaciones forman parte de la copia de seguridad/restauración de la Vigencia.

## Auditoría

Se incluyen botones **Nota** en:

- Consejería (proceso general de ponderación)
- Programa
- Proyecto

Las notas utilizan el módulo de Auditoría existente y `Ir a referencia` vuelve a Ponderaciones y resalta el elemento correspondiente.

## Cambio en Proyectos

El botón Ponderaciones del módulo Proyectos ya no guarda porcentajes directamente; ahora redirige al nuevo módulo para impedir que se omita el proceso de aprobación.

## Control de edición

La ponderación queda de solo lectura en los formularios de Proyecto. Los ajustes oficiales se realizan desde el nuevo módulo **Ponderaciones**, evitando guardar porcentajes por fuera del flujo de aprobación.
