ONIC BUEN GOBIERNO · v0.16.0
Control de calidad + Buscador global + Mi trabajo

BASE
----
Esta versión parte de la v0.15.0 funcional.

IMPORTANTE
----------
- NO requiere ejecutar ninguna migración SQL.
- El parche NO incluye js/config.js.
- Copiar el contenido del parche sobre la versión actual.
- Después realizar una recarga forzada del navegador: Ctrl + Shift + R.

NOVEDADES
---------
1. MI TRABAJO
   Nuevo módulo personal que reúne, por Vigencia:
   - Compromisos abiertos asignados al usuario.
   - Compromisos vencidos o próximos a vencer.
   - Proyectos cuyo campo Responsable coincide con el nombre/correo del perfil.
   - Actividades cuyo campo Responsable coincide con el nombre/correo del perfil.
   - Notas de Auditoría abiertas creadas por el usuario.
   - Accesos directos a la referencia correspondiente.

2. CONTROL DE CALIDAD
   Nuevo tablero de revisión estructural de Proyectos.
   Evalúa, sin modificar datos:
   - Objetivo general.
   - Responsable.
   - Fechas del Proyecto.
   - Existencia de Actividades.
   - Responsable y fechas de Actividades.
   - Indicadores activos por Actividad.
   - Línea base, meta, unidad y sentido válidos en Indicadores.
   - Ponderación del Programa igual a 100 %.

   Clasifica los Proyectos como:
   - Completo: 100 %.
   - Requiere ajustes: 75 % a 99,99 %.
   - Incompleto: menos de 75 %.

   El porcentaje corresponde a calidad estructural y NO al avance técnico.

3. BUSCADOR GLOBAL
   Nuevo botón Buscar en la barra superior.
   Atajo: Ctrl + K.
   Busca entre la información que el usuario tiene autorizada:
   - Vigencias.
   - Consejerías.
   - Líneas de Acción.
   - Programas.
   - Proyectos.
   - Actividades.
   - Indicadores.
   - Evidencias.
   - Mandatos.
   - Compromisos.

   Cada resultado ofrece acceso directo a su ubicación dentro del Sistema.
   Los resultados respetan las políticas y permisos ya existentes.

ARCHIVOS NUEVOS
---------------
js/modules/miTrabajo.js
js/modules/controlCalidad.js
js/modules/buscadorGlobal.js

ARCHIVOS MODIFICADOS
--------------------
index.html
css/styles.css
js/app.js

PRUEBA RÁPIDA
-------------
1. Iniciar sesión.
2. Abrir Mi trabajo y seleccionar una Vigencia.
3. Verificar compromisos y responsabilidades personales.
4. Abrir Control de calidad y revisar el porcentaje de un Proyecto conocido.
5. Pulsar Buscar o Ctrl + K.
6. Buscar el código o nombre de un Proyecto y abrirlo desde el resultado.
