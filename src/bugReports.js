// In-app bug reporter, pure logic. Reports live in localStorage; the UI is
// components/BugReporter.jsx.
const KEY = 'bugReports';
const MODE_KEY = 'bugMode';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I
const REF_RE = /\b(?:ET|E|L|P)[-\d][\w-]*\b/g;          // driver types, drivers, links, positions

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window: session only */ } };

export const loadReports = () => {
  try { const a = JSON.parse(read(KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
};
export const saveReports = (list) => write(KEY, JSON.stringify(list));
export const loadMode = () => read(MODE_KEY) === '1';
export const saveMode = (on) => write(MODE_KEY, on ? '1' : '0');

export function newId(taken) {
  for (;;) {
    let id = '';
    for (let i = 0; i < 6; i += 1) id += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    if (!taken.has(id)) return id;
  }
}

const clip = (t, n = 60) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

export function describeElement(el) {
  if (!el || !el.tagName) return '';
  const label = el.getAttribute('aria-label') || el.getAttribute('title') || el.value || el.textContent;
  return clip(`${el.getAttribute('role') || el.tagName.toLowerCase()} “${clip(label)}”`);
}

export function domContext(target) {
  const areas = [];
  for (let e = target; e && e.getAttribute && areas.length < 6; e = e.parentElement) {
    const a = e.getAttribute('data-debug-id') || e.getAttribute('data-testid');
    if (a) areas.push(a);
  }
  const tr = target?.closest?.('tr');
  const row = tr ? [...tr.cells].slice(0, 10).map((c) => clip(c.textContent, 40)).join(' | ') : '';
  const code = target?.closest?.('[data-code]')?.getAttribute('data-code') || '';
  const dialogs = [...document.querySelectorAll('.modal.show .modal-title')].map((n) => clip(n.textContent));
  const refs = [...new Set(`${target?.textContent ?? ''} ${row} ${code}`.match(REF_RE) || [])].slice(0, 10);
  return { element: describeElement(target), areas, dialogs, row, refs, code };
}

// A capture-phase click trail: the last 10 clicks, so a report shows how you got there.
export const trail = [];
export function noteClick(e, screen) {
  if (e.target?.closest?.('[data-bug-reporter]')) return;
  trail.push({ at: new Date().toISOString(), screen, label: describeElement(e.target) });
  if (trail.length > 10) trail.shift();
}

export function buildReport({ note, kind, target, withWhere, app, taken }) {
  const r = {
    id: newId(taken), at: new Date().toISOString(), note,
    ...(kind ? { kind } : {}),
    version: typeof __APP_VERSION__ === 'undefined' ? 'dev' : __APP_VERSION__,
  };
  if (withWhere) {
    Object.assign(r, { app, dom: domContext(target), trail: [...trail],
      viewport: `${window.innerWidth}×${window.innerHeight}` });
  }
  return r;
}

const when = (iso) => iso.replace('T', ' ').slice(0, 19);
export function reportsToMarkdown(list) {
  const out = [`# Bug reports (${list.length})`];
  for (const r of [...list].sort((a, b) => a.at.localeCompare(b.at))) {
    const first = r.note.split('\n')[0].slice(0, 80);
    out.push('', `## ${r.id} · ${r.kind === 'feature' ? 'Feature request · ' : ''}${first}`, '', r.note, '');
    const L = [`- **When:** ${when(r.at)}`, `- **Version:** ${r.version}`];
    const a = r.app || {};
    const where = [['Hub', a.zone], ['Screen', a.screen], ['Mode', a.mode], ['Window', r.dom?.dialogs?.join(' › ')]]
      .filter(([, v]) => v).map(([k, v]) => `**${k}:** ${v}`).join(' / ');
    if (where) L.push(`- ${where}`);
    if (r.dom?.element) L.push(`- **Clicked:** ${r.dom.element}`);
    if (r.dom?.areas?.length) L.push(`- **Area:** ${r.dom.areas.map((x) => `\`${x}\``).join(' › ')}`);
    const extra = [['Refs', r.dom?.refs?.join(', ')], ['Code', r.dom?.code], ['Row', r.dom?.row && `| ${r.dom.row} |`]]
      .filter(([, v]) => v).map(([k, v]) => `**${k}:** ${v}`).join(' / ');
    if (extra) L.push(`- ${extra}`);
    if (a.counts) L.push(`- **Counts:** ${Object.entries(a.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    if (r.viewport) L.push(`- **Viewport:** ${r.viewport}`);
    out.push(...L);
    if (r.trail?.length) {
      out.push('', '<details><summary>Last clicks</summary>', '',
        ...r.trail.map((t, i) => `${i + 1}. ${t.at.slice(11, 19)} [${t.screen}] ${t.label}`), '', '</details>');
    }
  }
  return `${out.join('\n')}\n`;
}
