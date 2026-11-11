# ONIC Buen Gobierno · V5.4.7 · Consejerías estructuradas

## Objetivo
Separar la consulta operativa de Consejerías de la configuración institucional y convertir cada Consejería en una vista consolidada de su estructura de planeación dentro de una Vigencia.

## Consejerías · vista operativa
- La pantalla principal trabaja por Vigencia y deja de mostrar el catálogo institucional.
- Se muestran totales consolidados de Consejerías, Líneas, Programas y Proyectos / Actividades.
- Cada tarjeta muestra responsable, pueblo, avance del Plan, cobertura y conteos de estructura.
- La acción principal pasa a ser **Ver Consejería**.

## Workspace de Consejería
Se agregan dos secciones:

### Resumen
- Totales de Líneas de Acción, Programas, Proyectos y Actividades.
- Lectura rápida por Línea con sus cantidades de Programas, Proyectos y Actividades.

### Estructura
- Árbol navegable y desplegable:
  - Línea de Acción
  - Programa
  - Proyecto / Actividad general
  - Actividad
- Cada Proyecto o Actividad puede abrirse directamente en su módulo original, conservando el contexto de Vigencia, Consejería, Línea y Programa.
- Las Actividades generales se contabilizan una sola vez y no se duplican con su registro técnico interno.

Se conservan además **Perfil de vigencia**, **Mandatos** y **Biblioteca**.

## Configuración administrativa
- Se crea el módulo **Configuración**, visible para administradores.
- Inicialmente integra:
  - Consejerías: catálogo institucional, vinculación a Vigencias y administración existente.
  - Usuarios y permisos: reutiliza el módulo actual de Usuarios.
- El acceso directo a Usuarios se reemplaza en el menú por Configuración.
- Historial se mantiene como módulo administrativo independiente.

## Base de datos
No se realizaron cambios de esquema ni migraciones. La versión utiliza las relaciones existentes entre `consejerias`, `vigencia_consejerias`, `lineas_accion`, `programas`, `proyectos` y `actividades`.

## Compatibilidad
Se mantienen las funciones existentes de Perfil de Vigencia, Mandatos, Biblioteca, avance de Consejería, permisos y auditoría.
