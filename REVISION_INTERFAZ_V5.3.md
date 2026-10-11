# ONIC Buen Gobierno · V5.3 Usabilidad

## Objetivo

Esta revisión parte de V5.2 Interfaz y se concentra en que una persona que no conoce la estructura técnica del sistema pueda orientarse, completar tareas y cambiar de módulo con menos pasos y menor riesgo de perder información.

No modifica la base de datos, RLS, RPC, usuarios, roles, fórmulas de avance, ponderaciones, cortes, alertas, respaldo/restauración ni la lógica funcional de los módulos.

## Cambios principales

### 1. Contexto visible y navegación jerárquica

Se incorporó una barra de contexto que conserva y muestra, cuando corresponde, la ruta de trabajo:

**Vigencia → Consejería → Línea de Acción → Programa**

Los elementos del contexto son navegables. En el espacio de trabajo de Proyecto/Actividad se conserva el breadcrumb propio para evitar duplicación visual.

### 2. Conservación del contexto entre módulos

La selección estratégica se mantiene durante la sesión para reducir selecciones repetidas. Se conserva, según el módulo, la Vigencia, Consejería, Línea y Programa previamente utilizados.

Los módulos principales ahora pueden recibir el contexto heredado al navegar. Se reforzó especialmente la entrada contextual de Programas y Mandatos.

### 3. Protección de cambios sin guardar

Los formularios de edición relevantes detectan cambios. Si el usuario intenta abandonar la vista, cambiar de pestaña, cerrar un modal o salir del sistema, se solicita confirmación antes de perder los datos.

La barra superior muestra discretamente **Cambios sin guardar** mientras exista una edición pendiente.

### 4. Acciones principales más consistentes

Guardar, Cancelar, Cerrar, Editar, Eliminar, Archivar, Actualizar, Importar, Descargar, Aprobar, Volver y Abrir utilizan una iconografía y tratamiento visual común.

Las acciones destructivas se separan visualmente de las acciones normales y los formularios extensos mantienen las acciones principales accesibles.

### 5. Estados vacíos guiados

Los listados o módulos sin información ya no se limitan a mostrar una pantalla vacía. Cuando es posible, explican el siguiente paso y ofrecen acceso directo al módulo donde debe crearse o vincularse la información requerida.

### 6. Ayuda contextual

Se añadieron ayudas breves para conceptos que pueden resultar poco claros para un usuario nuevo, entre ellos:

- Ponderación
- Cobertura
- Línea base
- Meta
- Avance técnico
- Contribución
- Corte
- Avance asociado

La ayuda se muestra sin ocupar permanentemente espacio en la interfaz.

### 7. Inicio adaptado al rol

Inicio incluye accesos rápidos según el perfil de la persona:

- Administrador: Mi trabajo, Control de calidad, Alertas y tareas, Usuarios.
- Coordinador: Mi trabajo, Control de calidad, Alertas y tareas, Cortes.
- Consejería: Mi trabajo, Proyectos, Alertas y tareas, Seguimiento de Mandatos.
- Consulta: Proyectos, Seguimiento de Mandatos, Cortes, Control de calidad.

### 8. Móvil y tablas

Las tablas sencillas pasan a una presentación por tarjetas en pantallas pequeñas. Las tablas que necesitan comparación horizontal conservan desplazamiento. Se mantuvieron botones táctiles, menú lateral móvil y formularios de una sola columna.

### 9. Terminología

Se unificó el término **Avance técnico** en la interfaz y documentos en lugar de alternarlo con “Cumplimiento técnico”. Se conservaron los términos institucionales necesarios y se evitó exponer vocabulario propio de programación.

### 10. Mensajes y estados

Los estados de carga, confirmaciones y errores mantienen el lenguaje de V5.1/V5.2: el usuario recibe un mensaje funcional y no detalles internos de la plataforma. Los avisos de éxito usan el mismo sistema visual.

## Última observación del error 400

El `400` observado en consola durante la prueba de V5.1 correspondió a un token de sesión antiguo que Supabase intentó renovar (`refresh_token_not_found`). La autenticación posterior respondió correctamente y no se identificó como fallo de los módulos. V5.3 conserva el comportamiento estable confirmado en V5.1/V5.2.

## Validaciones realizadas

- Sintaxis verificada sobre todos los archivos JavaScript con `node --check`.
- Rutas de importación relativas verificadas.
- Recursos locales referenciados desde `index.html` verificados.
- No quedan referencias de caché `v=5.2.0`; la versión usa `v=5.3.0`.
- Balance de llaves CSS verificado.
- `js/config.js` permanece sin cambios respecto de V5.2.
- Se intentó una prueba automatizada con Chromium, pero el entorno bloquea el acceso del navegador a `localhost` (`ERR_BLOCKED_BY_ADMINISTRATOR`), por lo que la revisión visual final debe realizarse en el equipo local.

## Prueba recomendada antes de adoptar como estable

1. Iniciar sesión como Administrador.
2. Seleccionar una Vigencia en Inicio.
3. Navegar Consejería → Línea → Programa → Proyecto y comprobar que el contexto se conserva.
4. Editar un Proyecto, cambiar un campo y tratar de salir sin guardar; debe aparecer la advertencia.
5. Guardar el Proyecto y comprobar el mensaje de éxito.
6. Abrir una Actividad y repetir la prueba.
7. Revisar Ponderaciones, Cortes, Alertas, Seguimiento de Mandatos, Mi trabajo y Control de calidad.
8. Probar Buscar y Auditoría.
9. Reducir la ventana a tamaño móvil y comprobar menú, tablas y formularios.
10. Repetir una prueba breve con los roles Coordinador, Consejería y Consulta.

Si estas pruebas son correctas, V5.3 puede tomarse como nueva base estable de interfaz.
