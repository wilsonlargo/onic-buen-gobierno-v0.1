# Revisión integral de interfaz · ONIC Buen Gobierno V5.2

## Criterio de revisión

La revisión tomó como base la versión V5.1 auditada y se concentró en que la aplicación pueda ser utilizada por una persona promedio sin conocer su arquitectura interna. No se modificaron los cálculos, la seguridad, la estructura de Supabase ni las reglas funcionales del sistema.

## Problemas detectados en la interfaz anterior

1. El menú lateral tenía muchos elementos consecutivos sin agrupación, por lo que la jerarquía funcional no era evidente.
2. La iconografía mezclaba caracteres tipográficos y símbolos diferentes para acciones equivalentes.
3. Mi trabajo y Control de calidad utilizaban el mismo símbolo, aunque son módulos distintos.
4. La barra superior, los paneles y algunas cabeceras ocupaban más espacio vertical del necesario.
5. Varias páginas repetían el nombre del módulo en la barra superior y nuevamente dentro del contenido.
6. Los botones tenían alturas, fondos y tratamientos distintos según el módulo.
7. Las pestañas de Proyecto, Consejería, Alertas y Mi trabajo no compartían un patrón visual único.
8. Los selectores jerárquicos de Líneas, Programas y Proyectos consumían mucho espacio antes de mostrar los datos.
9. Las ayudas extensas de Ponderaciones y Seguimiento de Mandatos aparecían siempre abiertas, aunque un usuario habitual no necesita leerlas en cada ingreso.
10. Los estados de carga variaban entre módulos y en algunos casos solo aparecía texto plano.
11. Las tablas y tarjetas podían presentar una densidad desigual entre módulos.
12. El espacio disponible para trabajar con tablas era menor de lo necesario por el ancho del menú y el padding general.
13. En móvil, algunas acciones secundarias competían por espacio con el título y la información del usuario.

## Solución aplicada

### Navegación

El menú se organizó en cuatro grupos:

- General: Inicio y Mi trabajo.
- Planeación: Vigencias, Mandatos, Consejerías, Líneas de Acción, Programas, Proyectos y Ponderaciones.
- Seguimiento: Seguimiento de Mandatos, Cortes, Alertas y tareas y Control de calidad.
- Administración: Historial y Usuarios, respetando los permisos existentes.

El menú ahora tiene desplazamiento interno cuando la pantalla es baja y oculta completamente un grupo si el rol no tiene elementos visibles dentro de él.

### Iconografía

Se sustituyeron los símbolos heterogéneos del menú por un conjunto SVG de trazo común. El mismo sistema se reutiliza para acciones como guardar, editar, eliminar, crear, actualizar, descargar, importar, volver, aprobar, abrir y cerrar.

El Buscador global también utiliza la misma familia visual para Vigencias, Consejerías, Líneas, Programas, Proyectos, Actividades, Indicadores, Evidencias y Mandatos.

### Densidad y aprovechamiento del espacio

- Menú lateral: 236 px en escritorio.
- Barra superior: aproximadamente 68 px.
- Contenido principal: padding reducido y consistente.
- Paneles: menor margen y padding.
- Hero panels internos: tamaño reducido.
- Tarjetas de métricas: más compactas.
- Tablas: filas y encabezados más densos sin perder legibilidad.
- Botones de tablas: versión compacta en escritorio y táctil en móvil.

### Acciones

Los botones se normalizaron en cuatro tratamientos principales:

- Primario: acción principal de la pantalla o formulario.
- Secundario: acción complementaria.
- Peligro: eliminación o acción destructiva.
- Botón de icono: cerrar, eliminar u otras acciones puntuales.

Las acciones comunes reciben iconos consistentes automáticamente sin alterar los identificadores ni los eventos existentes.

### Formularios

Los controles ahora comparten altura, borde, foco y tipografía. Los formularios de dos columnas pasan a una columna en móvil. Las zonas de acciones de formularios se mantienen accesibles en pantallas pequeñas.

### Selectores jerárquicos

Las pantallas de Líneas, Programas, Proyectos y Ponderaciones conservan la secuencia Vigencia → Consejería → Línea → Programa, pero el bloque se presenta de forma más horizontal y compacta en escritorio. En móvil vuelve a una columna.

### Pestañas

Proyecto, Consejería, Mi trabajo y Alertas utilizan ahora un patrón de pestañas común. Se añadió estado ARIA y navegación por teclado con flechas, Inicio y Fin.

### Ayuda contextual

Las explicaciones largas de Ponderaciones y Seguimiento de Mandatos se convirtieron en bloques desplegables. La información sigue disponible, pero no ocupa espacio durante el trabajo cotidiano.

### Carga y errores

Los estados de “Cargando” y “Calculando” se presentan con un indicador visual común. La pantalla de error de módulo utiliza mensajes amigables y permite intentar cargar nuevamente, conservando la protección incorporada en V5.1 para no mostrar mensajes técnicos de Supabase al usuario.

### Móvil

- Menú lateral tipo cajón.
- Título de módulo compacto.
- Buscar, Auditoría y Salir se convierten en controles de icono cuando falta espacio.
- Botones táctiles más altos.
- Acciones horizontales desplazables cuando es necesario.
- Formularios de una columna.
- Modales tipo hoja inferior en teléfonos estrechos.

## Elementos que deliberadamente no se modificaron

- Cálculo de avance técnico.
- Cobertura de medición.
- Ponderaciones y reglas de aprobación.
- Cortes y estados.
- Alertas automáticas y compromisos.
- RLS y roles.
- Funciones RPC.
- Estructura de tablas.
- Exportaciones PDF, Word y Excel.
- Respaldo/restauración.

La V5.2 es una revisión de experiencia de usuario sobre la base funcional V5.1, no una reescritura del sistema.
