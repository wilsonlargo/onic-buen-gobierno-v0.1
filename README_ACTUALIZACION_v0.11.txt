ONIC · SISTEMA DE BUEN GOBIERNO
ACTUALIZACIÓN v0.11.0 · SEGURIDAD Y TRABAJO MULTIUSUARIO
============================================================

OBJETIVO
--------
Esta versión incorpora control de acceso por roles, alcance por Consejería,
protección frente a ediciones simultáneas e historial automático de actividad.
No modifica la lógica de cálculo del avance técnico, las ponderaciones
automáticas, el presupuesto ni la estructura estratégica del Plan.

ANTES DE ACTUALIZAR
-------------------
1. Conserva una copia de la versión estable que actualmente utilizas.
2. Conserva también una copia de js/config.js.
3. Verifica que las migraciones 001 a 014 ya estén aplicadas.

BASE DE DATOS
-------------
Ejecuta UNA SOLA VEZ el archivo:

    sql/015_seguridad_multiusuario_historial.sql

NO vuelvas a ejecutar las migraciones 001 a 014.

La migración 015:
- crea perfiles y asignaciones de usuarios;
- establece los roles Administrador, Coordinador, Consejería y Consulta;
- reemplaza el acceso amplio de desarrollo por permisos reales;
- incorpora control de versión para evitar sobrescrituras silenciosas;
- crea el Historial automático de actividad;
- protege las aprobaciones simultáneas de Ponderaciones;
- conserva las Notas de Auditoría como un componente independiente.

ADMINISTRADOR INICIAL
---------------------
Al ejecutar 015, si todavía no existe un Administrador activo, la cuenta
existente más antigua queda como Administrador inicial. Desde el módulo
Usuarios puede asignar posteriormente los roles y Consejerías de las demás
cuentas existentes.

ROLES
-----
Administrador
- Acceso general.
- Administra usuarios, roles y asignaciones.
- Puede realizar acciones administrativas de la Vigencia.

Coordinador
- Acceso transversal al Plan.
- Puede formular, hacer seguimiento y aprobar Ponderaciones.
- Puede consultar el Historial.

Consejería
- Accede únicamente a la Consejería o Consejerías asignadas.
- Puede trabajar Proyectos, Actividades, Indicadores, Presupuesto,
  Evidencias, Seguimiento, Biblioteca y Notas de Auditoría según su alcance.
- No administra usuarios ni aprueba Ponderaciones oficiales.

Consulta
- Puede consultar la información autorizada.
- No puede modificarla.

HISTORIAL DE ACTIVIDAD
----------------------
El Sistema registra automáticamente las acciones relevantes, entre ellas:
- creación, modificación y eliminación de registros;
- avances de indicadores;
- cambios presupuestales;
- Evidencias y Seguimientos;
- Notas de Auditoría;
- aprobación de Ponderaciones;
- cambios de usuarios y permisos;
- inicio y cierre de sesión;
- importación y respaldo de Vigencias;
- generación de documentos;
- conflictos de edición detectados.

El módulo Historial muestra por defecto los últimos 7 días. También permite
consultar 30 días, 90 días, un periodo personalizado o todo el histórico.
Los registros NO se eliminan automáticamente al cumplir siete días.

El Historial puede exportarse en:
- TXT: lectura cronológica y respaldo sencillo;
- CSV: análisis y filtros externos.

AUDITORÍA E HISTORIAL SON DIFERENTES
-----------------------------------
Auditoría:
Observaciones, solicitudes, respuestas y revisión humana.

Historial:
Registro automático de lo que realmente hicieron los usuarios.

CONCURRENCIA
------------
Los registros principales utilizan control de versión. Si dos personas abren
el mismo registro y una guarda primero, la segunda no podrá sobrescribir el
cambio sin revisarlo. El Sistema mostrará un mensaje indicando que el registro
fue modificado por otro usuario.

Las Ponderaciones tienen una protección adicional: la aprobación solo se
realiza si los Proyectos conservan la misma versión sobre la cual se preparó
la propuesta. Si otra persona modificó alguno, la aprobación se cancela de
forma completa y se solicita recargar la información.

INSTALACIÓN DE ARCHIVOS
-----------------------
Opción A · Proyecto completo
Reemplaza la aplicación por la carpeta de esta versión. Si tu js/config.js
contiene la configuración que ya funciona, conserva esa copia.

Opción B · Parche
Copia únicamente los archivos incluidos en el paquete de parche sobre la
versión v0.10.1 estable. El parche no incluye js/config.js.

Después de copiar los archivos, recarga el navegador sin caché:

    Ctrl + Shift + R

PRIMERA COMPROBACIÓN
--------------------
1. Inicia sesión con la cuenta Administrador inicial.
2. Comprueba que aparezcan Usuarios e Historial en el menú.
3. En Usuarios, asigna a las otras cuentas su rol correspondiente.
4. Si una cuenta tiene rol Consejería, asígnale una o varias Consejerías.
5. Inicia sesión con cada tipo de usuario y comprueba los permisos.
6. Realiza una modificación sencilla y comprueba que aparezca en Historial.
7. Exporta los últimos 7 días en TXT para verificar el registro.

NOTA SOBRE CUENTAS NUEVAS
-------------------------
El módulo Usuarios administra permisos de cuentas que ya existen. La creación
de credenciales de acceso continúa realizándose mediante la administración de
autenticación institucional. Esto evita exponer funciones administrativas
sensibles dentro del navegador.
