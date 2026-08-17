# ONIC Buen Gobierno — v0.9.2 · Fondo institucional de ingreso

Esta actualización incorpora la imagen suministrada como fondo de la pantalla
inicial de acceso.

## Comportamiento

La imagen:

- ocupa toda la pantalla de ingreso;
- mantiene su proporción mediante `background-size: cover`;
- funciona como marca de agua mediante una capa institucional semitransparente;
- conserva la legibilidad del logo, título y formulario;
- no altera el fondo de la aplicación una vez iniciado sesión;
- se adapta a pantallas pequeñas.

## No requiere SQL

## Reemplazar

```text
index.html
css/styles.css
assets/branding/fondo-inicio-onic.png
```

No reemplazar:

```text
js/config.js
```

Después:

```text
Ctrl + Shift + R
```
