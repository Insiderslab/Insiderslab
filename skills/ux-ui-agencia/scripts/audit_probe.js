#!/usr/bin/env node
/*
 * Traccia strumentale dell'audit — misure deterministiche con Playwright.
 *
 * Apre la pagina alle viewport indicate (più 320px per il reflow), salva screenshot e
 * produce:
 *   probe.json            misure grezze (reflow, zoom, lang, campi, target, focus, console)
 *   palette-estratta.json coppie colore testo/sfondo e bordi dei campi, nel formato di
 *                         contrast_check.py (passarla allo script per il gate G3)
 *   probe-*.png           screenshot primo schermo e pagina intera per viewport
 *
 * Uso:
 *   node audit_probe.js https://staging.cliente.it/checkout --out ./evidenze
 *   node audit_probe.js URL --viewports 375x812,1440x900 --max-tab 80
 *   node audit_probe.js URL --submit-vuoto     # SOLO in ambiente di test (vedi H3)
 *
 * Requisiti: Playwright con Chromium. axe-core facoltativo: se `require('axe-core')`
 * funziona, viene iniettato e i risultati finiscono in probe.json.
 *
 * Limiti dichiarati (vanno in "Non verificato" se non controllati a mano):
 *   - testo su gradienti o immagini: la coppia è marcata "sfondo non uniforme", si verifica
 *     il punto peggiore a mano;
 *   - il focus "visibile" è dedotto dal cambio di stile calcolato, non dalla percezione;
 *   - l'assenza di errori axe non chiude nessun criterio.
 */
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.error('❌ Playwright non disponibile: installa `playwright` o fai le misure a mano.');
  process.exit(2);
}

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a));
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
if (!url) { console.error('Uso: node audit_probe.js URL [--out dir] [--viewports 375x812,1440x900] [--max-tab 60] [--submit-vuoto]'); process.exit(2); }
const OUT = path.resolve(opt('--out', 'evidenze-audit'));
const VIEWPORTS = opt('--viewports', '375x812,1440x900').split(',').map((v) => v.split('x').map(Number));
const MAX_TAB = Number(opt('--max-tab', '60'));
const SUBMIT = args.includes('--submit-vuoto');
fs.mkdirSync(OUT, { recursive: true });

let AXE = null;
try { AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'); } catch (e) { /* facoltativo */ }

// --- funzioni eseguite nella pagina -------------------------------------------------
function misure() {
  const cs = (el, p) => getComputedStyle(el, p || null);
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
  const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}`;
  const visibile = (el) => { const r = el.getBoundingClientRect(); const s = cs(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const labelDi = (el) => (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
  const campi = [...document.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(visibile).map((el) => ({
    el: desc(el), tipo: el.getAttribute('type') || (el.tagName === 'INPUT' ? '(assente → text)' : el.tagName.toLowerCase()),
    placeholder: el.placeholder || null, autocomplete: el.getAttribute('autocomplete'), inputmode: el.getAttribute('inputmode'),
    etichetta_visibile: !!labelDi(el), aria_label: el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'),
    solo_placeholder: !labelDi(el) && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !!el.placeholder,
    incolla_bloccato: /return\s+false|preventDefault/.test(el.getAttribute('onpaste') || ''),
    font_px: parseFloat(cs(el).fontSize), box: box(el),
  }));
  const inLinea = (el) => el.tagName === 'A' && el.closest('p, li, td') && (el.closest('p, li, td').innerText || '').trim().length > (el.innerText || '').trim().length + 10;
  const target = [...document.querySelectorAll('a[href], button, [role=button], input[type=checkbox], input[type=radio], [onclick], summary')]
    .filter(visibile).map((el) => ({ el: desc(el), testo: (el.innerText || el.getAttribute('aria-label') || el.title || '').trim().slice(0, 40), box: box(el), in_linea: !!inLinea(el), nome_accessibile: !!((el.innerText || '').trim() || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.title), elemento_nativo: ['A', 'BUTTON', 'INPUT', 'SUMMARY'].includes(el.tagName) }));
  const nativi = 'a[href], button, input, select, textarea, summary, label, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=switch]';
  const finti = [...document.querySelectorAll('body *')].filter((el) => visibile(el) && cs(el).cursor === 'pointer' && !el.matches(nativi) && !el.closest(nativi) && !(el.parentElement && cs(el.parentElement).cursor === 'pointer'))
    .map((el) => ({ el: desc(el), testo: (el.innerText || el.title || '').trim().slice(0, 40), box: box(el), tabindex: el.getAttribute('tabindex'), title: el.title || null }));
  const testi = [...document.querySelectorAll('p, li, span, a, button, label, td, th, h1, h2, h3, h4, h5, h6, small, strong, b, em, div')]
    .filter((el) => visibile(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1));
  const sfondo = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const s = cs(n);
      if (s.backgroundImage && s.backgroundImage !== 'none') return { colore: null, non_uniforme: s.backgroundImage.slice(0, 80) };
      if (s.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor)) return { colore: s.backgroundColor };
    }
    return { colore: 'rgb(255, 255, 255)' };
  };
  const coppie = testi.map((el) => { const s = cs(el); const bg = sfondo(el); return { el: desc(el), testo: el.innerText.trim().slice(0, 40), fg: s.color, bg: bg.colore, non_uniforme: bg.non_uniforme || null, size_px: parseFloat(s.fontSize), bold: parseInt(s.fontWeight, 10) >= 700 }; });
  campi.forEach((c, i) => { const el = [...document.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(visibile)[i]; const s = cs(el); if (parseFloat(s.borderTopWidth) > 0) coppie.push({ el: c.el + ' (bordo)', testo: '', fg: s.borderTopColor, bg: sfondo(el.parentElement || el).colore, uso: 'ui' }); if (c.placeholder) coppie.push({ el: c.el + ' (placeholder)', testo: c.placeholder.slice(0, 40), fg: cs(el, '::placeholder').color, bg: s.backgroundColor, size_px: parseFloat(s.fontSize), bold: false }); });
  const doc = document.documentElement;
  const meta = document.querySelector('meta[name=viewport]')?.content || null;
  const corpo = testi.filter((el) => ['P', 'LI', 'TD', 'LABEL', 'SPAN'].includes(el.tagName)).map((el) => parseFloat(cs(el).fontSize));
  return {
    viewport: { w: innerWidth, h: innerHeight }, scroll_orizzontale: doc.scrollWidth > doc.clientWidth + 1, scrollWidth: doc.scrollWidth,
    lang: doc.getAttribute('lang'), viewport_meta: meta, zoom_bloccato: !!meta && /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?(\s|,|$)/.test(meta),
    label_totali: document.querySelectorAll('label').length, campi, target, coppie,
    cliccabili_non_semantici: finti,
    corpo_min_px: corpo.length ? Math.min(...corpo) : null,
  };
}

function statoFocus() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const s = getComputedStyle(el); const r = el.getBoundingClientRect();
  const punti = [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]].map(([fx, fy]) => [r.x + r.width * fx, r.y + r.height * fy]);
  const coperti = punti.filter(([x, y]) => { if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false; const top = document.elementFromPoint(x, y); return top && top !== el && !el.contains(top) && !top.contains(el); }).length;
  return { el: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`, testo: (el.innerText || el.placeholder || el.getAttribute('aria-label') || '').trim().slice(0, 30), stile: [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.backgroundColor, s.textDecorationLine].join('|'), punti_coperti: coperti };
}

// --- conversione colori per la palette ------------------------------------------------
const hex = (rgb) => {
  if (!rgb) return null; const m = rgb.match(/rgba?\(([^)]+)\)/); if (!m) return null;
  const [r, g, b, a] = m[1].split(',').map((v) => parseFloat(v));
  const h = (n) => Math.round(n).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b) + (a !== undefined && a < 1 ? h(a * 255) : '');
};

(async () => {
  const browser = await chromium.launch();
  const risultato = { url, data: new Date().toISOString().slice(0, 10), axe: AXE ? 'iniettato' : 'non disponibile', viewport: {} };
  const tutteLeCoppie = new Map();
  const vps = [...VIEWPORTS, [320, 640]];
  for (const [w, h] of vps) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 768, hasTouch: w < 768 });
    const page = await ctx.newPage();
    const errori = [];
    page.on('pageerror', (e) => errori.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errori.push(m.text()); });
    await page.goto(url, { waitUntil: 'load' });
    const k = `${w}x${h}`;
    const m = await page.evaluate(misure);
    m.errori_console = errori;
    await page.screenshot({ path: path.join(OUT, `probe-${k}-primo-schermo.png`) });
    await page.screenshot({ path: path.join(OUT, `probe-${k}-intera.png`), fullPage: true });
    if (w !== 320) {
      // percorso da tastiera: stile con focus vs senza focus, copertura da elementi sovrapposti
      const passi = [];
      for (let i = 0; i < MAX_TAB; i++) {
        await page.keyboard.press('Tab');
        const con = await page.evaluate(statoFocus);
        if (!con) break;
        const senza = await page.evaluate(() => { const el = document.activeElement; el.blur(); const s = getComputedStyle(el); const v = [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.backgroundColor, s.textDecorationLine].join('|'); el.focus({ preventScroll: true }); return v; });
        passi.push({ ...con, focus_visibile: con.stile !== senza, interamente_coperto: con.punti_coperti === 5, parzialmente_coperto: con.punti_coperti > 0 && con.punti_coperti < 5 });
        if (passi.length > 1 && passi[0].el === con.el && passi[0].testo === con.testo) { passi.pop(); break; }
      }
      // ritorno con Shift+Tab: è qui che header e banner sticky coprono il focus (WCAG 2.4.11)
      const ritorno = [];
      for (let i = 0; i < passi.length; i++) {
        await page.keyboard.press('Shift+Tab');
        const st = await page.evaluate(statoFocus);
        if (!st) break;
        ritorno.push({ el: st.el, testo: st.testo, interamente_coperto: st.punti_coperti === 5, parzialmente_coperto: st.punti_coperti > 0 && st.punti_coperti < 5 });
      }
      const coperti = [...passi, ...ritorno];
      m.tastiera = { elementi_raggiunti: passi.length, senza_focus_visibile: passi.filter((p) => !p.focus_visibile).length,
        interamente_coperti: [...new Set(coperti.filter((p) => p.interamente_coperto).map((p) => `${p.el} "${p.testo}"`))],
        parzialmente_coperti: [...new Set(coperti.filter((p) => p.parzialmente_coperto).map((p) => `${p.el} "${p.testo}"`))], passi };
      if (AXE && w === VIEWPORTS[VIEWPORTS.length - 1][0]) {
        await page.addScriptTag({ content: AXE });
        const ax = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] })).violations.map((v) => ({ id: v.id, impatto: v.impact, criteri: v.tags.filter((t) => /^wcag\d/.test(t)), nodi: v.nodes.length })));
        risultato.axe_violazioni = ax;
      }
      if (SUBMIT && w === VIEWPORTS[0][0]) {
        const prima = await page.evaluate(() => document.body.innerText);
        const btn = await page.$('form [type=submit], form button:not([type=button])');
        if (btn) {
          await btn.click();
          await page.waitForTimeout(800);
          m.invio_vuoto = await page.evaluate((testoPrima) => ({ focus_dopo: document.activeElement ? document.activeElement.tagName.toLowerCase() + (document.activeElement.id ? '#' + document.activeElement.id : '') : null, campi_aria_invalid: document.querySelectorAll('[aria-invalid=true]').length, regioni_live: document.querySelectorAll('[aria-live], [role=alert], [role=status]').length, testo_nuovo: document.body.innerText.split('\n').filter((r) => r.trim() && !testoPrima.includes(r)).slice(0, 10) }), prima);
          await page.screenshot({ path: path.join(OUT, `probe-${k}-invio-vuoto.png`) });
        }
      }
    }
    m.target_sotto_24 = m.target.filter((t) => !t.in_linea && (t.box.w < 24 || t.box.h < 24)).map((t) => `${t.el} "${t.testo}" ${t.box.w}×${t.box.h}`);
    if (w < 768) m.target_sotto_44_mobile = m.target.filter((t) => !t.in_linea && (t.box.w < 44 || t.box.h < 44)).map((t) => `${t.el} "${t.testo}" ${t.box.w}×${t.box.h}`);
    m.coppie.forEach((c) => {
      const fg = hex(c.fg); const bg = hex(c.bg);
      const chiave = `${fg}|${bg || c.non_uniforme}|${c.uso || (c.size_px >= 24 || (c.bold && c.size_px >= 18.66) ? 'testo-grande' : 'testo')}`;
      if (!tutteLeCoppie.has(chiave)) tutteLeCoppie.set(chiave, { ...c, fg, bg });
    });
    delete m.coppie;
    risultato.viewport[k] = m;
    await ctx.close();
  }
  await browser.close();

  const coppie = []; const nonUniformi = [];
  for (const c of tutteLeCoppie.values()) {
    if (!c.fg) continue;
    if (!c.bg) { nonUniformi.push(`${c.el} "${c.testo}" su ${c.non_uniforme}`); continue; }
    const voce = { nome: `${c.el}${c.testo ? ' "' + c.testo + '"' : ''}`, fg: c.fg, bg: c.bg };
    if (c.uso) voce.uso = c.uso; else { voce.size_px = c.size_px; voce.bold = c.bold; }
    coppie.push(voce);
  }
  risultato.sfondi_non_uniformi_da_verificare_a_mano = nonUniformi;
  fs.writeFileSync(path.join(OUT, 'probe.json'), JSON.stringify(risultato, null, 2));
  fs.writeFileSync(path.join(OUT, 'palette-estratta.json'), JSON.stringify({ coppie }, null, 2));

  // riepilogo leggibile
  const vp = Object.entries(risultato.viewport);
  console.log(`Misure per ${url} — ${risultato.data}`);
  for (const [k, m] of vp) {
    const r = [`[${k}]`, `scroll orizzontale: ${m.scroll_orizzontale ? '❌ sì' : '✅ no'}`, `corpo min: ${m.corpo_min_px ?? '—'}px`, `target < 24px: ${m.target_sotto_24.length}`];
    if (m.target_sotto_44_mobile) r.push(`target < 44px (mobile): ${m.target_sotto_44_mobile.length}`);
    if (m.tastiera) r.push(`focus non visibile: ${m.tastiera.senza_focus_visibile}/${m.tastiera.elementi_raggiunti}`, `focus interamente coperto: ${m.tastiera.interamente_coperti.length}`, `in parte: ${m.tastiera.parzialmente_coperti.length}`);
    if (m.cliccabili_non_semantici.length) r.push(`cliccabili non semantici: ${m.cliccabili_non_semantici.length}`);
    r.push(`errori console: ${m.errori_console.length}`);
    console.log(r.join(' · '));
  }
  const m0 = vp[0][1];
  console.log(`lang: ${m0.lang || '❌ assente'} · zoom bloccato: ${m0.zoom_bloccato ? '❌ sì' : '✅ no'} · campi solo placeholder: ${m0.campi.filter((c) => c.solo_placeholder).length}/${m0.campi.length} · campi senza autocomplete: ${m0.campi.filter((c) => !c.autocomplete).length}`);
  console.log(`axe: ${risultato.axe}${risultato.axe_violazioni ? ' — ' + risultato.axe_violazioni.length + ' regole violate' : ''}`);
  console.log(`Coppie colore estratte: ${coppie.length} → python3 contrast_check.py --palette ${path.join(OUT, 'palette-estratta.json')} --modo audit`);
  if (nonUniformi.length) console.log(`⚠️ ${nonUniformi.length} testi su gradiente/immagine: verificare a mano il punto peggiore.`);
  console.log(`Output: ${OUT}`);
})().catch((e) => { console.error('❌ Errore:', e.message); process.exit(1); });
