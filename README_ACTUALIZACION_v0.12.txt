ONIC BUEN GOBIERNO · v0.12.0
PLANEADOR DEL PROYECTO
========================================

BASE
----
Esta versión parte de la v0.11.0 multiusuario que contiene Usuarios,
Historial, roles, permisos y control de concurrencia.

NO crea Objetivos específicos ni modifica la jerarquía del Plan.
El Planeador utiliza directamente las Actividades ya existentes.

PASO 1 · BASE DE DATOS
----------------------
Ejecutar UNA SOLA VEZ en Supabase:

  sql/016_planeador_proyecto.sql

No volver a ejecutar las migraciones 001–015.

La migración agrega únicamente el campo visual planeador_color a las
Actividades y actualiza el núcleo de copia de seguridad/restauración para
conservar ese color. Fechas, responsable, indicadores, presupuesto,
evidencias y seguimiento siguen usando la información existente.

PASO 2 · ARCHIVOS
-----------------
Si usas el parche, copiar su contenido sobre la aplicación actual.

El parche NO incluye js/config.js, por lo que conserva la configuración
actual de tu proyecto.

PASO 3 · RECARGA
----------------
La v0.12.0 añade versionado de recursos para reducir problemas de caché.
Después de copiar los archivos haz una recarga forzada:

  Ctrl + Shift + R

NUEVA FUNCIÓN
-------------
Abrir un Proyecto y seleccionar:

  Perfil | Planeador | Actividades | Seguimiento

El Planeador tiene:

1. Vista matriz
   - Actividad existente.
   - Responsable.
   - Periodo de inicio y cierre.
   - Avance técnico calculado.
   - Estado temporal.
   - Indicadores.
   - Evidencias.
   - Presupuesto.
   - Acceso a Seguimiento.
   - Nota de Auditoría.
   - Acceso directo a Abrir Actividad.

2. Vista cronograma
   - Línea de tiempo mensual o trimestral.
   - Duración calculada desde las fechas del Proyecto o de sus Actividades.
   - Barras del periodo programado.
   - Avance técnico dentro de la barra.
   - Línea de la fecha actual cuando está dentro del periodo.
   - Actividades sin fechas claramente identificadas.

3. Colores
   - Automático.
   - Verde.
   - Azul.
   - Turquesa.
   - Amarillo.
   - Naranja.
   - Rojo.
   - Morado.
   - Gris.

El color es únicamente visual. No modifica avance, estado, presupuesto,
ponderación ni contribución.

4. Navegación integrada
   Desde una fila del Planeador se puede entrar directamente a:
   - Indicadores
   - Evidencias
   - Presupuesto
   - Seguimiento

Al regresar desde una Actividad abierta desde el Planeador, el sistema
vuelve al Planeador, no a una sección distinta.

5. Multiusuario
   El Planeador conserva el control de concurrencia de v0.11.0. Si dos
   personas modifican la misma Actividad, se utiliza la protección de
   versión ya existente. Las restricciones de rol también siguen activas.

MÓVILES
-------
La matriz se reorganiza como tarjetas en pantallas pequeñas. El cronograma
mantiene desplazamiento horizontal táctil para conservar la lectura lineal
sin deformar la escala temporal.
