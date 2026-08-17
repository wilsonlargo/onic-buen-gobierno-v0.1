# ONIC Buen Gobierno — v0.9.1

## Cambio principal

La generación documental ya no expone LaTeX al usuario.

El flujo es:

```text
Generar documento
→ Descargar PDF
→ Descargar Word
```

## No requiere SQL nuevo

## Reemplazar

```text
index.html
css/styles.css
js/modules/documentReports.js
js/modules/inicio.js
js/modules/vigencias.js
js/modules/consejeriaWorkspace.js
js/modules/proyectoWorkspace.js
```

Eliminar, si todavía existe:

```text
js/modules/latexReports.js
```

No reemplazar:

```text
js/config.js
```

Después:

```text
Ctrl + Shift + R
```

## Alcances disponibles

- Vigencia completa
- Consejería completa
- Proyecto completo

## PDF

Se genera directamente en el navegador como `.pdf`.

## Word

Se genera directamente en el navegador como `.docx` editable.
