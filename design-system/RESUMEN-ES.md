# Design System InsidersLab — resumen operativo (ES)

Versión 1.0 · 22/09/2026 · Fuente: Brand Book InsidersLab (Canva `DAHRh4VZtME`).
El documento completo está en `DESIGN-SYSTEM-INSIDERSLAB.md` (IT). Los tokens, en
`design-tokens.css` y `design-tokens.json`.

## Color

| Nombre | HEX | Uso |
|---|---|---|
| Azul InsidersLab | `#2F3AE4` | dominante (55%), CTA, enlaces |
| Azul editorial | `#2042BE` | hover, enlaces en texto |
| Lima | `#AAD800` | acento (9%) — **nunca fondo mayoritario, nunca texto sobre claro** |
| Negro | `#000000` | texto sobre lima, semitono |
| Papel | `#F7F7F5` | fondo alterno (20%) |
| Azul profundo · cielo · verde hoja · lila | `#344C8C` `#298CE8` `#80AE52` `#8880E0` | secundarios |

**Contrastes medidos:** blanco sobre azul 7,38:1 ✅ · negro sobre lima 12,53:1 ✅ ·
lima sobre azul editorial 4,85:1 ✅ · lima sobre azul `#2F3AE4` 4,40:1 ⚠️ solo ≥24px ·
lima sobre blanco 1,68:1 ❌ · blanco sobre lima 3,04:1 ❌ · blanco sobre verde hoja 2,59:1 ❌.

Si necesitas lima como **texto** sobre claro, usa `#647F00` (4,59:1).

## Tipografía

- **Arvo** 400/700 → titulares. Nunca en párrafos largos, nunca bajo 22px, máximo 3 líneas.
- **Open Sans** 300–800 → todo el cuerpo, UI y datos.
- Escala (desktop / tablet / móvil): H1 56/44/34 · H2 40/34/28 · H3 28/26/22 · H4 22/20/19 ·
  cuerpo 16 en los tres (mínimo absoluto) · small 14 · eyebrow 12 mayúscula +0,12em.
- Interlineado del texto de lectura: nunca bajo 1,5.

## Espaciado y rejilla

Escala 4 · 8 · 16 · 24 · 32 · 48 · 64 · 96 px. Padding de sección 96 / 64 / 48.
Ancho máximo de contenido 1200px, línea de lectura máx. 72 caracteres.
Radios 4px y 8px. Sombra única `0 12px 32px rgba(47,58,228,.10)` — la sombra es azul.

## Botones y estados

- Primario: fondo `#2F3AE4`, texto blanco → hover `#2042BE` → active `#1B2FA8`.
- Acento: fondo lima, **texto negro** (nunca blanco). Uno por pantalla.
- Secundario: borde 2px azul, texto azul, hover fondo `#EEF0FE`.
- Foco **siempre visible**: anillo 2px `#111827` con offset 2px.
- Input: borde `#8E94A3`, alto 48px, texto 16px, foco borde azul 2px. Error: borde `#A11B14`
  **más mensaje de texto**, no solo el borde rojo.

## Logo

5 posiciones (4 esquinas o centro) · aire = altura de la «L» · mínimos 30mm impreso,
110px pantalla, 70px isotipo. Prohibido: recolorear, deformar, rotar, efectos, fondo ocupado,
separar el nombre, cambiar el descriptor (*Creative Agency*).

## Sistema gráfico y foto

Papel (100%) · semitono · recorte · estrella (máx. 3) · trazo · cinta. Giro ±15°.
**25% del lienzo en reposo.** Foto en blanco y negro, trama visible, recorte a silueta,
contorno 3–6 px. Sin color, sin render 3D.

## Social 1080 × 1350

Plantillas A Declaración · B Pregunta · C Sistema · D Llamada.
Logo blanco arriba → titular a dos colores (**una sola palabra en lima**) → subtítulo máx.
2 líneas → un solo recorte protagonista → acentos en las esquinas libres.
Ritmo: máx. 2 piezas seguidas con el mismo fondo; 1 de papel claro por cada 3 de azul.
