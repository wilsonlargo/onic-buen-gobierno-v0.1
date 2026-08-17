# ONIC · Sistema de Buen Gobierno v0.1

Primera base funcional para la reestructuración del Sistema de Gestión y Seguimiento al Plan Estratégico de la ONIC.

## Tecnología

- HTML5
- CSS3
- JavaScript nativo (Vanilla JS)
- Supabase
  - PostgreSQL
  - Auth
- VS Code
- GitHub

No utiliza React, Vite ni otro framework de frontend.

## Qué incluye esta versión

- Interfaz institucional base.
- Login con correo y contraseña mediante Supabase Auth.
- Menú lateral.
- Dashboard inicial.
- Primer módulo funcional: **Vigencias**.
- Creación y consulta de vigencias directamente en Supabase.
- Modelo relacional inicial:
  - vigencias
  - consejerias
  - vigencia_consejerias
  - fuentes_mandatos
  - mandatos
  - mandato_consejerias
  - lineas_accion
  - programas
  - proyectos
- RLS inicial para usuarios autenticados.
- Proyecto como nodo operativo central.
- Ponderación modificable únicamente en el nivel Proyecto.

## 1. Crear el proyecto en Supabase

Crea un proyecto nuevo en Supabase.

En el **SQL Editor**, ejecuta en este orden:

1. `sql/001_core.sql`
2. `sql/002_dev_rls.sql`

## 2. Configurar Supabase en el frontend

Edita:

`js/config.js`

y completa:

```js
window.APP_CONFIG = {
  supabaseUrl: "https://TU-PROYECTO.supabase.co",
  supabaseKey: "TU-CLAVE-PUBLICA"
};
```

Usa únicamente la clave pública/publishable o anon del proyecto.

**Nunca uses `service_role` en código del navegador.**

## 3. Crear el primer usuario

Para esta versión no hay registro público desde la interfaz.

Crea el primer usuario desde Supabase Auth y luego ingresa en la aplicación con su correo y contraseña.

## 4. Ejecutar localmente

Como la aplicación usa módulos JavaScript, ejecútala mediante un servidor local.

### Opción VS Code

Puedes usar una extensión como Live Server y abrir `index.html`.

### Opción terminal

Desde la carpeta del proyecto:

```bash
python3 -m http.server 5500
```

Luego abre:

```text
http://localhost:5500
```

## 5. Iniciar repositorio Git

```bash
git init
git add .
git commit -m "Inicio Sistema Buen Gobierno ONIC v0.1"
git branch -M main
git remote add origin URL_DE_TU_REPOSITORIO
git push -u origin main
```

## Modelo relacional inicial

```text
VIGENCIA
│
├── FUENTES DE MANDATOS
│    └── MANDATOS
│         └── MANDATO_CONSEJERIAS
│
└── VIGENCIA_CONSEJERIAS
     └── LINEAS_ACCION
          └── PROGRAMAS
               └── PROYECTOS
```

### Reglas ya consideradas

- Las consejerías son un catálogo institucional estable.
- Las consejerías tienen `nombre_largo` y `nombre_corto`.
- Los responsables de consejería se registran por vigencia.
- Los mandatos pertenecen a una vigencia.
- Pueden existir múltiples fuentes de mandatos por vigencia.
- El código de un mandato lo define el usuario.
- Un mandato puede relacionarse con varias consejerías.
- Las líneas de acción son creadas por los usuarios.
- Los programas son creados por los usuarios.
- El proyecto es el nodo operativo central.
- El proyecto puede usar ponderación manual o sugerida.
- Programa y Línea no tendrán ponderación manual: se calcularán hacia arriba.
- Los porcentajes se almacenan como números, sin el símbolo `%`.

## Próxima iteración propuesta

1. CRUD completo de Vigencias.
2. Catálogo de Consejerías.
3. Asociación Consejerías ↔ Vigencia.
4. Fuentes de Mandatos.
5. Mandatos y asignación a varias consejerías.
6. Línea de Acción.
7. Programa.
8. Proyecto básico.
9. Proyecto extendido / marco lógico.
10. Presupuesto y seguimiento.

## Nota sobre seguridad

Las políticas de `002_dev_rls.sql` son deliberadamente simples para iniciar el desarrollo:
cualquier usuario autenticado tiene acceso completo a las tablas del núcleo.

Antes de producción deberán sustituirse por políticas de permisos según perfiles, consejerías y responsabilidades.
