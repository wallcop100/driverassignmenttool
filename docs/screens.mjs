// Renders each of the tool's surfaces to standalone HTML for the docs, using the
// real demo model, the real engine, and the app's own stylesheet — so a
// screenshot is of what the code produces, not of a drawing of it.
//
//   node docs/screens.mjs           write the HTML
//   node docs/shoot.mjs             capture them to docs/img/*.png
//
// Writes docs/driver-types.html and docs/estimate.html.
import fs from 'node:fs';
import * as e from '../src/engine.js';
import { canFill, canReplace, faults, ratingsOf } from '../src/typeFaults.js';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const m = e.buildModel(
  fs.readFileSync(`${root}/src/demo/form.csv`, 'utf8'),
  fs.readFileSync(`${root}/src/demo/links.csv`, 'utf8'),
);
const fmt = (n) => (n == null ? null : (Number.isInteger(n) ? n : +n.toFixed(2)));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// usage per type, as both screens compute it
const usage = new Map();
for (const d of m.drivers) {
  const c = usage.get(d.typeRef) ?? { count: 0, zones: new Set() };
  c.count += 1; if (d.zone) c.zones.add(d.zone); usage.set(d.typeRef, c);
}
const zoneList = (zones) => {
  const z = [...zones].sort();
  return z.length > 2 ? `${z[0]} +${z.length - 1}` : z.join(', ');
};

// flagged first, then by Ref — the reason to open the page is at the top of it
const cards = m.inventory
  .map((t) => { const spec = e.resolveSpec(t.name || t.typeRef); return { t, spec, f: faults(t, spec) }; })
  .sort((a, b) => (b.f.length > 0) - (a.f.length > 0) || a.t.typeRef.localeCompare(b.t.typeRef));

const badge = (t) => `<span class="type-power is-${(t.powerType || 'unknown').toLowerCase()}">${t.powerType ?? '—'}</span>`;

/* ---- the types page: one card per ElementType ---- */
const cardHtml = cards.map(({ t, spec, f }) => {
  const u = usage.get(t.typeRef);
  return `<div class="tp-card${f.length ? ' is-off' : ''}">
    <div class="tp-card-top"><span class="tp-ref">${esc(t.typeRef)}</span></div>
    <div class="tp-line">${badge(t)}<span class="tp-name">${esc(t.name || '—')}</span></div>
    <div class="tp-spec">${esc(ratingsOf(t))}</div>
    ${f.length ? `<div class="tp-fault" title="${esc(f.map((x) => x[1]).join(' '))}">${esc(f.map((x) => x[0]).join(' · '))}</div>` : ''}
    <div class="tp-foot">
      <span class="tp-use">${u ? u.count + ' × ' + zoneList(u.zones) : 'unused'}</span>
      <button class="tp-icon"><span class="material-icons">edit</span></button>
      <button class="tp-icon"><span class="material-icons">more_vert</span></button>
    </div>
  </div>`;
}).join('');

// the ⋮ menu, opened on the one card that has both fixes to offer
const flagged = cards.find(({ t, spec }) => canFill(t, spec) && canReplace(t, spec)) ?? cards[0];
const menuHtml = `<div class="tp-card is-off" style="max-width:320px">
  <div class="tp-card-top"><span class="tp-ref">${esc(flagged.t.typeRef)}</span></div>
  <div class="tp-line">${badge(flagged.t)}<span class="tp-name">${esc(flagged.t.name)}</span></div>
  <div class="tp-spec">${esc(ratingsOf(flagged.t))}</div>
  <div class="tp-fault">${esc(flagged.f.map((x) => x[0]).join(' · '))}</div>
  <div class="tp-foot">
    <span class="tp-use">1 × HUB-E</span>
    <button class="tp-icon"><span class="material-icons">edit</span></button>
    <span class="tp-menu-wrap"><button class="tp-icon"><span class="material-icons">more_vert</span></button>
      <div class="tp-menu" style="position:static;margin-top:4px">
        <button>Fill blanks from ${esc(flagged.spec.name)}</button>
        <button class="is-warn">Use the spec page (${fmt(flagged.spec.maxPowerW)}W)</button>
      </div></span>
  </div>
</div>`;

/* ---- the picker: add a driver to a hub ---- */
const pickerHtml = m.inventory
  .map((t) => ({ t, f: faults(t, e.resolveSpec(t.name || t.typeRef)) }))
  .sort((a, b) => (usage.get(b.t.typeRef)?.count ?? 0) - (usage.get(a.t.typeRef)?.count ?? 0))
  .map(({ t, f }) => `<div class="pk-row${f.length ? ' is-off' : ''}">
    <span class="pk-ref">${esc(t.typeRef)}</span>${badge(t)}
    <span class="pk-spec">${esc(ratingsOf(t))}</span>
    <span class="pk-name">${esc(t.name || '—')}</span>
    ${f.length ? '<span class="pk-warn"><span class="material-icons">warning_amber</span></span>' : ''}
    <span class="pk-use">${usage.get(t.typeRef)?.count ?? 0} in use</span>
    <span class="pk-add">add</span>
  </div>`).join('');

/* ---- the new-type dialog: filters, then what they leave ---- */
const seg = (vals, on) => `<div class="nt-seg">${vals.map((v) => `<button class="${v === on ? 'is-on' : ''}">${v}</button>`).join('')}</div>`;
const matches = e.PARTS.filter((p) => p.kind !== 'supply' && !p.discontinued
  && p.powerType === 'CC' && p.maxA != null && p.maxA >= 0.5);
const dialogHtml = `<div class="nt-dialog" style="box-shadow:none;border:1px solid #dbe3ee">
  <div class="nt-head"><b>New driver type</b>
    <span class="text-secondary small">${matches.length} of ${e.PARTS.length} parts</span>
    <button class="btn btn-sm btn-link ms-auto p-0">close</button></div>
  <div class="nt-filters">
    <div class="nt-filter"><span>Type</span>${seg(['CC', 'CV', 'any'], 'CC')}</div>
    <label class="nt-filter"><span>Current ≥</span><input type="number" value="500"><em>mA</em></label>
    <label class="nt-filter"><span>Power ≥</span><input type="number" placeholder="W"><em>W</em></label>
    <div class="nt-filter"><span>Outputs</span>${seg(['1', '2', 'any'], 'any')}</div>
    <input class="form-control form-control-sm nt-q" placeholder="Filter by name…">
  </div>
  <div class="nt-list">${matches.map((p, i) => `<div class="nt-part${i === 0 ? ' is-on' : ''}">
    <span class="type-power is-${p.powerType.toLowerCase()}">${p.powerType}</span>
    <span class="nt-part-name">${esc(p.name)}</span>
    <span class="nt-part-spec">${p.maxPowerW != null ? fmt(p.maxPowerW) + 'W' : 'W set by the supply'}${p.minA != null ? ` · ${p.minA}–${p.maxA}A` : ''}${p.maxFvV != null ? ` · ${p.maxFvV}fV/out` : ''}</span>
    <span class="nt-part-ch">${p.outputs ?? 1} out</span></div>`).join('')}</div>
  <div class="nt-pick">
    <label class="nt-filter"><span>CurrentRange</span><input type="number" value="700"><em>mA</em></label>
    <span class="nt-ref">ET-CCR-D-700-1CH-01</span>
  </div>
  <div class="nt-foot">
    <button class="btn btn-sm btn-link p-0 me-auto">edit all fields</button>
    <button class="btn btn-sm btn-outline-secondary">Cancel</button>
    <button class="btn btn-sm btn-outline-primary">Create</button>
    <button class="btn btn-sm btn-primary">Create and add to HUB-B1</button>
  </div>
</div>`;

const editor = `<div class="preset-editor px-3 py-3">
  <div class="spec-pick"><div class="spec-head"><b>ET-CCR-D-1050-1CH-01</b>
    <span class="text-secondary"> · EldoLED SoloDrive 360/A</span></div></div>
  <div class="spec-ref"><span>ET-CCR-D-1050-1CH-01</span></div>
  <div class="spec-row"><span class="spec-group">Driver</span>
    <div class="spec-cell"><select><option>CC</option></select><span class="col">Type</span></div>
    <div class="spec-cell"><input value="185" class="is-off"><span class="col">MaxPower(W)</span><span class="ds">datasheet 30</span></div>
    <div class="spec-cell"><input value="1.05"><span class="col">CurrentRange</span></div>
    <div class="spec-cell"><input value="1"><span class="col">BallastCountPerUoM</span></div>
    <div class="spec-cell"><input value="DALI"><span class="col">ControlType</span></div>
  </div>
  <div class="spec-row"><span class="spec-group">Per output</span>
    <div class="spec-cell"><input value="1"><span class="col">Parameters</span></div>
    <div class="spec-cell"><input placeholder="—"><span class="col">NodeMaxForwardVoltage(fV)</span><span class="ds">datasheet 55</span></div>
    <div class="spec-cell"><input placeholder="—"><span class="col">NodeMaxPower(W)</span></div>
    <div class="spec-cell"><input placeholder="—"><span class="col">NodeCurrent</span></div>
  </div>
  <div class="preset-note">EldoLED SoloDrive 360/A · 0.15–1.4A</div>
  <div class="d-flex gap-2 mt-3 align-items-center">
    <button class="btn btn-sm btn-primary">Save</button>
    <button class="btn btn-sm btn-outline-secondary">Cancel</button>
    <span class="badge text-bg-warning ms-auto">provisional</span>
  </div>
</div>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Driver types and the picker</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons">
<style>${fs.readFileSync(`${root}/node_modules/bootstrap/dist/css/bootstrap.min.css`, 'utf8')}</style>
<style>${fs.readFileSync(`${root}/src/styles.css`, 'utf8')}</style>
<style>
body{padding:24px;background:#f6f8fb}
.mockhead{font:600 12px/1.4 system-ui;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;margin:26px 0 8px}
.mockhead:first-child{margin-top:0}
.frame{background:#fff;border:1px solid #dbe3ee;border-radius:10px;padding:14px}
.dp-need{font-size:12px;color:#8a6d1f;background:#fdf6e3;border:1px solid #e2d7b4;border-radius:4px;padding:2px 8px}
</style>
</head><body>
<div class="mockhead">Add a driver to a hub — the picker</div>
<div class="frame"><div class="picker-page">
  <div class="dp-head">
    <button class="btn btn-sm btn-outline-secondary">← HUB-B1</button>
    <h5 class="mb-0">Add a driver to HUB-B1</h5>
    <input class="form-control form-control-sm ms-auto" style="max-width:240px" placeholder="Filter…">
  </div>
  <div class="dp-suggest"><div><b>HUB-B1 has 26 cables and no drivers yet</b>
    <div class="text-secondary small">4 × ET-CVR-D-24-2CH-01 would hold them, one ControlGroup each</div></div>
    <button class="btn btn-sm btn-primary ms-auto">Add these 4 drivers</button></div>
  <div class="pk-list">${pickerHtml}</div>
  <div class="pk-foot"><button class="btn btn-sm btn-outline-primary">New type…</button>
    <button class="btn btn-sm btn-link ms-auto">Manage types →</button></div>
</div></div>

<div class="mockhead">Driver types — the design's own ElementTypes, flagged first</div>
<div class="frame"><div class="types-page">
  <div class="dp-head">
    <button class="btn btn-sm btn-outline-secondary">← Zones</button>
    <h5 class="mb-0">Driver types</h5>
    <span class="text-secondary small">${m.inventory.length} types in the design</span>
    <span class="dp-need">${cards.filter((c) => c.f.length).length} worth a look</span>
    <input class="form-control form-control-sm ms-auto" style="max-width:220px" placeholder="Filter…">
    <button class="btn btn-sm btn-primary">New type</button>
  </div>
  <div class="tp-grid">${cardHtml}</div>
</div></div>

<div class="mockhead">The remedies, behind ⋮</div>
<div class="frame">${menuHtml}</div>

<div class="mockhead">✎ — every ElementTypes field, in the card</div>
<div class="frame">${editor}</div>

<div class="mockhead">New type — filters, then the shortlist they leave</div>
${dialogHtml}
</body></html>`;
fs.writeFileSync(new URL('./driver-types.html', import.meta.url), html);
console.log('cards:', cards.length, '· flagged:', cards.filter((c) => c.f.length).length);

/* ---- estimate: the third mode, from a requirement assessment ---- */
const estTypes = fs.readFileSync(`${root}/src/demo/form.csv`, 'utf8');   // types come from the demo library
const assess = `"Link_SecondaryPowerRef","LocationName","ControlTypeRef","ControlGrouptext","PositionTypeRef","SumQuantity","CC/CV","CV_Voltage","CC_Current","SumVf","SumPower"
"HUB-A","Study","DALI","L102-H-02","C01r","14.05","CV","24","","","337.2"
"HUB-A","Study","DALI","L102-H-03","B02w","2","CC","","0.3","70","23.6"
"HUB-A","Study","DALI","L102-H-05","B02w","3","CC","","0.3","105","35.4"
"HUB-A","Study","DALI","L102-L-02.B","W03b","1","CC","","0.35","20","6.8"
"HUB-B2","Drawing Rooms","DALI","L103-H-03","B02w","2","CC","","0.3","70","23.6"
"HUB-B2","Drawing Rooms","DALI","L103-H-07","B02w","3","CC","","0.3","105","35.4"
"HUB-B2","Drawing Rooms","DALI","L103-H-10","B02w","2","CC","","0.3","70","23.6"`;

// the demo form CSV doubles as a type library: same ElementTypeRef column
const em = e.buildEstimate(assess, estTypes);
const zones = e.estimate(em, { margin: 0.05 });
const units = em.requirements.reduce((n, r) => n + r.qty, 0);
const byType = new Map();
zones.forEach((z) => z.lines.forEach((l) => byType.set(l.typeRef, (byType.get(l.typeRef) ?? 0) + l.count)));
const f1 = (n) => (Number.isInteger(n) ? n : +n.toFixed(1));

const boxes = [
  ['ControlGroups', true], ['Fitting types', true], ['Rooms', false],
].map(([l, on]) => `<label class="est-c">${on ? '<input type="checkbox" checked>' : '<input type="checkbox">'}${l}</label>`).join('');

const estHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Driver estimate</title>
<style>${fs.readFileSync(`${root}/node_modules/bootstrap/dist/css/bootstrap.min.css`, 'utf8')}</style>
<style>${fs.readFileSync(`${root}/src/styles.css`, 'utf8')}</style>
<style>body{padding:24px;background:#f6f8fb}.frame{background:#fff;border:1px solid #dbe3ee;border-radius:10px;overflow:hidden}
.mockhead{font:600 12px/1.4 system-ui;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;margin:0 0 8px}</style>
</head><body>
<div class="mockhead">Estimate — Positions only, no cables and no drivers</div>
<div class="frame"><div class="container-fluid py-3 drivers-page">
  <div class="dp-head">
    <h5 class="mb-0">Driver estimate</h5>
    <span class="text-secondary small">${em.requirements.length} rows · ${em.zones.length} hubs · no links yet</span>
  </div>
  <div class="est-constraints"><span class="est-c-label">Keep separate</span>${boxes}
    <span class="est-c-label ms-3">Choosing a part</span>
    <label class="est-c"><input type="checkbox" checked>Prefer single output</label>
    <span class="est-c-label ms-3">Spare capacity</span>
    <label class="est-c"><input type="number" class="form-control form-control-sm margin-input" value="5">% margin</label></div>
  <div class="est-total"><b>${zones.reduce((n, z) => n + z.drivers, 0)} drivers</b>
    <span class="text-secondary">${[...byType.entries()].sort().map(([t, n]) => `${n} × ${t}`).join(' · ')}</span>
    <button class="btn btn-sm btn-outline-secondary ms-auto">Export CSV</button>
    <button class="btn btn-sm btn-primary">Copy Elements patch</button></div>
  <div class="dp-list mt-3">${zones.map((z) => `<div class="dp-part">
      <div class="dp-part-head" style="cursor:default">
        <span class="dp-name">${z.zone}</span>
        <span class="dp-spec">${f1(z.loadW)}W</span>
        <span class="dp-count">${z.drivers} driver${z.drivers === 1 ? '' : 's'}</span></div>
      ${z.lines.map((l) => `<div class="dp-ref">
        <span class="dp-ref-id">${l.count} × ${esc(l.typeRef)}</span>
        <span class="dp-ref-spec">${esc(l.positionTypes?.join(', ') || '—')} · ${f1(l.qty)} UoM · ${l.perDriver} per driver${l.perNode ? ` · ${l.perNode} per output` : ''}</span>
        <span class="dp-ref-use">${l.limit} limited</span>
        <span class="dp-ref-use">${esc(l.controlGroup || '—')}</span></div>`).join('')}
      ${z.unmatched.map((u) => `<div class="dp-ref is-off"><span class="dp-ref-id">${f1(u.qty)} UoM</span>
        <span class="dp-fault">${esc(u.reason ?? 'no type in the library can take these')} — ${esc(u.key)}</span></div>`).join('')}
    </div>`).join('')}</div>
</div></div>
</body></html>`;
fs.writeFileSync(new URL('./estimate.html', import.meta.url), estHtml);
console.log('estimate:', zones.reduce((n, z) => n + z.drivers, 0), 'drivers over', zones.length, 'hubs');
