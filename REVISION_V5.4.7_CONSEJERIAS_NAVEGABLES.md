# V5.4.7 · Consejerías navegables

## Alcance
Cambio limitado al módulo Consejerías y la navegación contextual.

## Consejerías
- Se restaura y renombra la acción operativa como **Agregar Consejería a esta vigencia**.
- La acción crea la relación vigencia–Consejería e incluye los datos propios del periodo.
- Las tarjetas incorporan **Editar datos de la vigencia** y **Ver Consejería** como acciones distintas.
- No se incorpora edición institucional en la vista operativa.
- **Configuración → Consejerías** queda limitado al catálogo institucional; se retiró de allí la vinculación a vigencias.

## Tarjetas
- Se ajustó la retícula del encabezado y el tamaño de foto.
- Nombres largos y datos de responsable/pueblo pueden envolver texto sin salir de la tarjeta.
- Las acciones se distribuyen de forma flexible y se apilan en pantallas pequeñas.

## Esquema interno
- Línea → abre Líneas de Acción con la Línea resaltada.
- Programa → abre Programas conservando la Línea y resalta el Programa.
- Proyecto / Actividad general → abre Proyectos / Actividades directamente en la unidad.
- Actividad interna → abre el Proyecto y la Actividad correspondiente.

## Datos
No requiere cambios de tablas, RLS, triggers ni migraciones de Supabase.
