# ONIC Buen Gobierno · V5.3.1

## Ajuste de gestión de Vigencias

Esta versión parte de V5.3 Usabilidad y corrige la gestión del estado de las Vigencias desde la interfaz.

### Cambios
- Edición completa de Vigencias existentes: nombre, fechas, lema, descripción y estado.
- Acciones directas de estado en la lista:
  - Borrador → Activar.
  - Activa → Cerrar.
  - Cerrada → Reabrir como borrador.
- Guía visible de los tres estados y su significado.
- Confirmación antes de cambiar de estado.
- Protección para impedir que se active una segunda Vigencia cuando ya existe otra activa.
- Mensajes comprensibles para el usuario cuando existe conflicto de Vigencia activa.
- Acciones de Vigencias reorganizadas y optimizadas en escritorio y móvil.
- Permisos: Administrador y Coordinador pueden editar/cambiar estados; Consejería y Consulta no ven estas acciones.
- Caché de módulos actualizado a v=5.3.1.

### No se modificó
- Supabase ni sus datos.
- Políticas RLS ni funciones RPC.
- Cálculos de avance, cobertura o ponderación.
- Lógica de Mandatos, Proyectos, Actividades, Cortes o Alertas.
