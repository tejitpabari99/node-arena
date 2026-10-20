// HUD metrics H01-H07 (PRD SP05 "Added HUD metrics"; CHECKLIST Appendix B; thresholds.json). Evaluated by visual:check from the
// per-frame `hud` record that visual:capture stores in metrics.json (collectHud, run inside the page). Null never passes.
//
// HUD DOM CONTRACT (SP05 Task 4 must implement; documented in CHECKLIST Appendix B.2). No existing hook is reusable: App.tsx v1
// has only `.hud` (dark bar), `.instructions` (help bar), `role=timer`, aria-label "Game speed"; those are the v1 look being removed.
//   [data-hud="root"]   HUD container (pointer-events none except controls); parent of everything below
//   [data-hud="pill"]   top-centre level pill (level name + timer + meter); H01/H02/H07 measure it
//   [data-hud="meter"]  strength bar, role="meter", aria-valuetext "Blue 62%, Red 38%"; contains one
//                       [data-hud-seg][data-team="<sim team id>"] element per team, in strength() segment order, widths = share
//   [data-hud="pause"]  round pause button (top-left)                      } H03 measures their bounding boxes
//   [data-hud="speed"]  round 1x/2x button (top-right)                     }
//   [data-hud="tip"]    first-level tip card (optional; counted in H04 area when present)
//   .instructions       the v1 bottom help bar; H05 requires zero of them in the DOM
// H06 expected shares come from `window.__na.strength()` (test-harness: the pure strength() of the current sim view, evaluated in
// the same page right after the frame), NOT from the meter's own aria text, so a HUD that renders wrong numbers cannot agree with itself.
// Pill colours (H07): pill `color` against the first non-transparent `background-color` walking up from the pill (alpha layers composited).
import { appliesTo, limitsFor, primaryFrame, within } from './metrics.mjs';

export const HUD_IDS = Array.from({ length: 7 }, (_, i) => `H${String(i + 1).padStart(2, '0')}`);
export const HUD_SELECTORS = {
  root: '[data-hud="root"]', pill: '[data-hud="pill"]', meter: '[data-hud="meter"]', seg: '[data-hud-seg]',
  pause: '[data-hud="pause"]', speed: '[data-hud="speed"]', tip: '[data-hud="tip"]', helpBar: '.instructions', legacyBar: '.hud',
};

/**
 * Runs inside the page (page.evaluate(collectHud, HUD_SELECTORS)); must stay self-contained. Plain JSON out, rects in CSS px.
 * `expected` = window.__na.strength() segments (team, pct) or null when unavailable.
 */
export function collectHud(sel) {
  const r3 = n => Math.round(n * 1000) / 1000;
  const rect = e => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: r3(b.x), y: r3(b.y), w: r3(b.width), h: r3(b.height) }; };
  const one = s => document.querySelector(s);
  const pill = one(sel.pill), meter = one(sel.meter), root = one(sel.root);
  let colors = null;
  if (pill) {
    const chain = [];
    for (let e = pill; e; e = e.parentElement) chain.push(getComputedStyle(e).backgroundColor);
    colors = { fg: getComputedStyle(pill).color, bgChain: chain };
  }
  const hudEls = [...document.querySelectorAll('[data-hud]')].filter(e => e !== root);
  const top = hudEls.filter(e => !hudEls.some(o => o !== e && o.contains(e)));
  let expected = null;
  try { expected = window.__na?.strength ? window.__na.strength().segments.map(s => ({ team: s.team, pct: s.pct })) : null; } catch { expected = null; }
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    root: rect(root), pill: rect(pill), colors,
    meter: meter ? {
      rect: rect(meter), role: meter.getAttribute('role'), valueText: meter.getAttribute('aria-valuetext'),
      segments: [...meter.querySelectorAll(sel.seg)].map(e => ({ team: e.getAttribute('data-team'), ...rect(e) })),
    } : null,
    buttons: { pause: rect(one(sel.pause)), speed: rect(one(sel.speed)) },
    tip: Boolean(one(sel.tip)),
    helpBars: document.querySelectorAll(sel.helpBar).length,
    area: root ? r3(top.reduce((a, e) => { const b = e.getBoundingClientRect(); return a + b.width * b.height; }, 0)) : null,
    legacyBar: rect(one(sel.legacyBar)),
    expected,
  };
}

// ---------- colour / contrast (WCAG 2.x; mirrors src/ui/tokens.ts contrastRatio, cross-checked in test/visual-hud.test.ts) ----------

/** 'rgb(r, g, b)' / 'rgba(r, g, b, a)' -> {r,g,b,a} (0-255, a 0-1) or null (also for 'color(srgb ...)' forms Chromium may emit). */
export function parseCssColor(text) {
  const m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(String(text).trim());
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4] };
  const c = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/.exec(String(text).trim());
  return c ? { r: +c[1] * 255, g: +c[2] * 255, b: +c[3] * 255, a: c[4] === undefined ? 1 : +c[4] } : null;
}
const lin = v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export const luminance = c => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** Composite a bottom-up list of CSS backgrounds (pill first) over white; null when a layer is unparsable. */
export function resolveBackground(chain) {
  let out = { r: 255, g: 255, b: 255 };
  for (const text of [...chain].reverse()) {
    const c = parseCssColor(text);
    if (!c) return null;
    out = { r: c.r * c.a + out.r * (1 - c.a), g: c.g * c.a + out.g * (1 - c.a), b: c.b * c.a + out.b * (1 - c.a) };
  }
  return out;
}

// ---------- evaluators: hud record -> { pass, value, text } ----------

const r3 = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const res = (pass, value, text) => ({ pass, value, text });
const none = text => res(false, null, text);

const HUD = {
  H01(hud, limits) {
    if (!hud?.pill) return none('no [data-hud="pill"]');
    const off = Math.abs(hud.pill.x + hud.pill.w / 2 - hud.viewport.w / 2) / hud.viewport.w;
    return res(within(off, limits.centreOffset), r3(off), `pill centre offset ${r3(off * 100)}% of width`);
  },
  H02(hud, limits) {
    if (!hud?.pill) return none('no [data-hud="pill"]');
    const share = hud.pill.y / hud.viewport.h;
    return res(within(share, limits.topShare), r3(share), `pill top ${r3(share * 100)}% of height`);
  },
  H03(hud, limits) {
    const parts = [];
    let ok = true;
    for (const name of ['pause', 'speed']) {
      const b = hud?.buttons?.[name];
      if (!b) { ok = false; parts.push(`${name} missing`); continue; }
      const lo = Math.min(b.w, b.h), hi = Math.max(b.w, b.h);
      if (!within(lo, limits.size) || !within(hi, limits.size)) ok = false;
      parts.push(`${name} ${r3(b.w)}x${r3(b.h)}`);
    }
    return res(ok, ok ? parts : null, `buttons ${parts.join(', ')} (CSS px, ${limits.size.min}-${limits.size.max})`);
  },
  H04(hud, limits) {
    if (!hud || hud.area === null) return none(`no [data-hud="root"]${hud?.legacyBar ? ` (v1 .hud bar ${hud.legacyBar.w}x${hud.legacyBar.h})` : ''}`);
    const share = hud.area / (hud.viewport.w * hud.viewport.h);
    return res(within(share, limits.areaShare), r3(share), `HUD area ${r3(share * 100)}% of viewport`);
  },
  H05(hud, limits) {
    if (!hud) return none('no hud record');
    return res(within(hud.helpBars, limits.count), hud.helpBars, `.instructions count ${hud.helpBars}`);
  },
  H06(hud, limits) {
    const m = hud?.meter;
    if (!m?.rect || !m.segments.length) return none('no [data-hud="meter"] segments');
    if (!hud.expected?.length) return none('no strength() expectation (window.__na.strength)');
    const sum = m.segments.reduce((a, s) => a + s.w, 0), sumErr = Math.abs(sum - m.rect.w);
    const errs = hud.expected.map(e => {
      const seg = m.segments.find(s => s.team === e.team);
      return seg ? Math.abs(seg.w / m.rect.w - e.pct / 100) : Infinity;
    });
    const worst = Math.max(...errs), extra = m.segments.length !== hud.expected.length;
    const pass = !extra && within(sumErr, limits.sumPx) && within(worst, limits.shareErr);
    return res(pass, { sumErrPx: r3(sumErr), worstShareErr: r3(worst) }, `segments ${m.segments.length}/${hud.expected.length}, width sum off ${r3(sumErr)} px, worst share error ${r3(worst * 100)}%`);
  },
  H07(hud, limits) {
    if (!hud?.colors) return none('no [data-hud="pill"] colours');
    const fg = parseCssColor(hud.colors.fg), bg = resolveBackground(hud.colors.bgChain);
    if (!fg || !bg) return none(`unparsable colours fg ${hud.colors.fg}`);
    const ratio = contrast({ r: fg.r, g: fg.g, b: fg.b }, bg);
    return res(within(ratio, limits.ratio), r3(ratio), `pill text contrast ${r3(ratio)}:1`);
  },
};

/** Table rows for one capture job (scene x viewport); only the metrics whose scene/viewport lists include it. */
export function evaluateHudJob({ scene, viewport, entry, thresholds }) {
  const rows = [], hud = primaryFrame(entry)?.hud ?? null;
  for (const id of HUD_IDS) {
    const def = thresholds.metrics[id];
    if (!def || !appliesTo(def, scene, viewport)) continue;
    let r;
    try { r = HUD[id](hud, limitsFor(def, scene, viewport)); } catch (error) { r = none(`error: ${error.message}`); }
    rows.push({ id, scene, viewport, status: r.pass ? 'pass' : 'fail', value: r.value ?? null, text: r.text });
  }
  return rows;
}

/** Per-metric verdict like metrics.summarize: fail if any row fails, else pass; missing = no rows. */
export function summarizeHud(rows) {
  const out = {};
  for (const id of HUD_IDS) {
    const mine = rows.filter(r => r.id === id);
    out[id] = !mine.length ? 'missing' : mine.some(r => r.status === 'fail') ? 'fail' : 'pass';
  }
  return out;
}
