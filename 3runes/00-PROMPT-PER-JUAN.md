# Prompt para Juan: proyecto 3Runes (nueva web + SEO + landings + blog)

> **Juan:** esta carpeta contiene todo lo necesario para rehacer 3runes.it. No tienes que inventar
> la estrategia, ya está decidida. Tu trabajo es ejecutarla con Claude, fase por fase, y pedirle
> el OK a Ste en cada checkpoint.

## Contenido de la carpeta

| Archivo | Qué es | Idioma |
|---|---|---|
| `00-PROMPT-PER-JUAN.md` | Este archivo: instrucciones y prompt para ti | ES |
| `01-brief-strategico-3runes.md` | Brief completo: posicionamiento, servicios, precios, sitemap, diseño y animaciones, keywords, landings por ciudad, GEO, competencia, KPI, roadmap | IT |
| `02-prompt-assistente-web.md` | Prompt de sistema de la cuenta Claude "Assistente Web" (stack, reglas, umbrales de calidad) | IT |
| `03-prompt-progetto-3runes.md` | Prompt operativo del proyecto: 8 fases con checkpoints | IT |
| `data/landing-pages.csv` | 75 páginas: URL, H1, keyword, volumen, prioridad. Es el **keyword map** | IT |
| `data/piano-editoriale-blog.csv` | 52 artículos con fecha y hora de publicación programada | IT |

**Importante:** todos los textos que se publican en la web van en **italiano**. Tú puedes hablar
con Claude en español.

## Cómo configurarlo (10 minutos)

1. En Claude, crea un **Proyecto** llamado `3Runes — Rifacimento sito`.
2. En **Instrucciones del proyecto**, pega el bloque de código que hay dentro de
   `02-prompt-assistente-web.md` (desde `# RUOLO` hasta el final).
3. En **Knowledge** del proyecto, sube estos archivos:
   - `01-brief-strategico-3runes.md`
   - `03-prompt-progetto-3runes.md`
   - `data/landing-pages.csv`
   - `data/piano-editoriale-blog.csv`
4. Comprueba que el conector de WordPress del sitio esté autorizado (y, si los usamos, también
   los de Hostinger y n8n). Si no lo están, pídeselo a Ste.
5. Abre un chat nuevo dentro del proyecto y pega el **PROMPT PARA CLAUDE** de aquí abajo.

---

## PROMPT PARA CLAUDE (copiar y pegar)

```text
Hola Claude, soy Juan, del equipo web de InsidersLab. Vamos a rehacer desde cero https://3runes.it
en WordPress (Hello Elementor child + Elementor Pro + Rank Math + ACF Pro), siguiendo AL PIE DE LA
LETRA estos documentos del proyecto:
- 01-brief-strategico-3runes.md (la estrategia, ya aprobada en sus líneas generales)
- 03-prompt-progetto-3runes.md (las fases, entregables y checkpoints)
- landing-pages.csv (keyword map: una keyword = una URL)
- piano-editoriale-blog.csv (52 artículos para programar en WordPress)

Reglas de trabajo conmigo:
1. Háblame en ESPAÑOL. Todo lo que se publica en la web (copy, meta, artículos, alt de imágenes)
   va en ITALIANO perfecto.
2. Trabajamos fase por fase, como dice 03-prompt-progetto-3runes.md. Al final de cada fase me das:
   (a) qué está hecho, (b) qué falta, (c) riesgos, (d) el mensaje para Ste en ITALIANO, listo para
   copiar, para pedirle el OK del checkpoint.
3. Todo se construye en STAGING. Nada se publica en producción sin el OK de Ste.
4. Si falta un dato (dirección, P.IVA, precios, casos de clientes, accesos), no lo inventes:
   márcalo como "⚠️ DA CONFERMARE" y añádelo a la lista de preguntas para Ste.
5. Dame especificaciones ejecutables: dónde hago clic en Elementor, qué contenedor, qué Global
   Color, qué campo ACF, qué código va en el child theme y en qué archivo. Si me das código, que
   esté completo, comentado y listo para pegar.
6. Landings por ciudad: contenido único real (mínimo 40%), nada de buscar-y-reemplazar el nombre
   de la ciudad, LocalBusiness solo en Udine y Torino.
7. Animaciones (Three.js / GSAP): carga condicional y diferida, prefers-reduced-motion, fallback.
   Si una animación empeora LCP/INP/CLS, gana el rendimiento.
8. Blog: cada artículo se sube como entrada programada (status "future") con la fecha y la hora
   (09:00 Europe/Rome) del CSV, categoría, slug, Rank Math (title, description, focus keyword) e
   imagen destacada. Los temas legales/fiscales (AI Act, leyes, ayudas, Transizione 5.0) se
   verifican con fuentes oficiales en la fecha de redacción y llevan disclaimer.

Empezamos por la FASE 0. Antes de nada dame:
(a) el plan operativo de la Fase 0, con la lista de accesos que necesito pedir (WordPress admin,
    hosting/staging, Search Console, GA4/GTM, Cloudflare, Iubenda, n8n, CRM);
(b) la lista consolidada de puntos "⚠️ DA CONFERMARE" del brief (§13), redactada en italiano
    como un único mensaje para Ste;
(c) los riesgos o incoherencias que veas en la estrategia, cada uno con una propuesta.
No empieces copy ni build antes del Checkpoint 1 (sitemap aprobada por Ste).
```

---

## Checklist rápida para Juan

| Fase | Qué entregas | Quién aprueba |
|---|---|---|
| 0 | Crawl de la web actual, inventario, `redirect-map.csv`, dossier, preguntas para Ste | Ste responde a las preguntas |
| 1 | Sitemap + keyword map + lista de plantillas de Theme Builder | **Ste aprueba la sitemap** |
| 2 | Kit de Elementor + prototipo del hero / las tres runas / el workflow animado en staging (link + vídeo) | Ste aprueba la dirección visual |
| 3 | Copy en italiano (home, hubs, servicios P0, 12 landings SEO T1, 5 landings AI fase 1) | Ste aprueba muestras |
| 4 | Build completo en staging, formularios → n8n → CRM, Runa Check | Checklist del gate de build |
| 5 | 52 artículos subidos como programados o borradores con fecha | Ste aprueba los 4 pilares + los temas legales |
| 6 | QA: PageSpeed móvil ≥ 90, accesibilidad AA, cookies, tracking, redirects | Veredicto PUBBLICABILE |
| 7 | Go-live **lunes 16/11/2026** + Search Console + Google Business Profile + directorios | Ste |

**Fecha clave:** go-live el 16/11/2026. Si se retrasa, Claude reprograma las fechas del blog manteniendo
el ritmo martes/jueves.

**Dudas:** a Ste, siempre en un solo mensaje con todas las preguntas juntas.
