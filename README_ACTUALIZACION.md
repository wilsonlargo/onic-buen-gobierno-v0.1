# ONIC Buen Gobierno — v0.9.3
## Avance del Plan por Consejería

Esta actualización hace visible el avance técnico de cada Consejería
dentro de la Vigencia.

## Qué se agrega

En las tarjetas de Consejerías vinculadas:

```text
Avance del Plan
XX,XX %
Estado del avance

Cobertura de medición
XX,XX %
```

En `Abrir Consejería` también aparecen:

```text
Avance del Plan
Cobertura de medición
Mandatos asignados
Biblioteca
Pueblo
```

## Regla de cálculo

No se crea un porcentaje manual.

Se utiliza exactamente la misma lógica jerárquica del tablero Inicio:

```text
Indicadores
→ Actividades
→ Proyectos
→ Programas
→ Líneas de Acción
→ Consejería
```

- Las Actividades tienen peso técnico automático.
- Los Proyectos utilizan su ponderación manual dentro del Programa.
- Los Programas activos se ponderan automáticamente dentro de la Línea.
- Las Líneas activas se ponderan automáticamente dentro de la Consejería.
- La cobertura indica qué proporción de la estructura tiene medición válida.
- Una Consejería inactiva queda fuera del cálculo.
- Si no existe cobertura de medición se muestra `—` y `Sin medición`.

## Estado visual

```text
Menos de 40 %       → Avance bajo
40 % a 69,99 %      → En proceso
70 % a 89,99 %      → Avance favorable
90 % o más          → Avance alto
Sin cobertura       → Sin medición
Consejería inactiva → Fuera del cálculo
```

## Instalación

No requiere SQL.

Reemplazar:

```text
index.html
css/styles.css
js/modules/consejerias.js
js/modules/consejeriaWorkspace.js
```

Agregar:

```text
js/modules/consejeriaProgress.js
```

No reemplazar:

```text
js/config.js
```

Después:

```text
Ctrl + Shift + R
```
