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

/* ---- the card, shared by both surfaces: only the actions differ ---- */
const warnChip = (f) => (f.length
  ? `<button class="tp-warn"><span class="material-icons">warning_amber</span>${f.length > 1 ? f.length + ' to check' : 'check this'}</button>`
  : '');

const card = ({ t, f }, actions, cls = '') => {
  const u = usage.get(t.typeRef);
  return `<div class="tp-card${f.length ? ' is-off' : ''}${cls}">
    <div class="tp-card-top"><span class="tp-ref">${esc(t.typeRef)}</span></div>
    <div class="tp-line">${badge(t)}<span class="tp-name">${esc(t.name || '—')}</span></div>
    <div class="tp-spec">${esc(ratingsOf(t))}<span class="tp-ch"> · ${t.nodes?.length ?? 1} out${t.ballast ? ' · ' + t.ballast + 'CH' : ''}</span></div>
    <div class="tp-foot">
      <span class="tp-use">${u ? u.count + ' × ' + zoneList(u.zones) : 'unused'}</span>
      ${warnChip(f)}${actions}
    </div>
  </div>`;
};

const cardHtml = cards.map((c) => card(c,
  '<button class="tp-icon"><span class="material-icons">edit</span></button>'
  + '<button class="tp-icon"><span class="material-icons">more_vert</span></button>')).join('');

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
const inHub = new Set(m.drivers.filter((d) => d.zone === 'HUB-A').map((d) => d.typeRef));
const pickerHtml = cards
  .slice()
  .sort((a, b) => (inHub.has(b.t.typeRef) - inHub.has(a.t.typeRef))
    || (usage.get(b.t.typeRef)?.count ?? 0) - (usage.get(a.t.typeRef)?.count ?? 0))
  .map((c) => card(c,
    '<button class="tp-icon"><span class="material-icons">edit</span></button>'
    + '<button class="tp-icon"><span class="material-icons">more_vert</span></button>'
    + '<button class="btn btn-sm btn-primary tp-add">Add</button>',
    inHub.has(c.t.typeRef) ? ' is-here' : '')).join('');

/* ---- the warning, opened ---- */
const fdCard = cards.find((c) => c.f.length > 1) ?? cards.find((c) => c.f.length);
const faultHtml = `<div class="fd-dialog" style="box-shadow:none;border:1px solid #dbe3ee">
  <div class="fd-head"><span class="fd-ref">${esc(fdCard.t.typeRef)}</span>
    <span class="fd-name">${esc(fdCard.t.name || '—')}</span>
    <button class="btn btn-sm btn-link ms-auto p-0">close</button></div>
  <div class="fd-states"><span><b>${esc(ratingsOf(fdCard.t))}</b> in the DesignDB</span>
    ${fdCard.spec ? `<span class="text-secondary">${esc(fdCard.spec.name)} spec page: ${fmt(fdCard.spec.maxPowerW)}W${fdCard.spec.minA != null ? ` · ${fdCard.spec.minA}–${fdCard.spec.maxA}A` : ''}${fdCard.spec.maxFvV != null ? ` · ${fdCard.spec.maxFvV}fV/out` : ''}</span>` : ''}</div>
  <ul class="fd-list">${fdCard.f.map(([short, full]) => `<li><b>${esc(short)}</b><span>${esc(full)}</span></li>`).join('')}</ul>
  <div class="fd-foot">
    ${canFill(fdCard.t, fdCard.spec) ? `<button class="btn btn-sm btn-outline-primary">Fill blanks from ${esc(fdCard.spec.name)}</button>` : ''}
    ${canReplace(fdCard.t, fdCard.spec) ? `<button class="btn btn-sm btn-outline-warning">Use the spec page (${fmt(fdCard.spec.maxPowerW)}W)</button>` : ''}
    <button class="btn btn-sm btn-link ms-auto">Close</button>
  </div>
</div>`;

/* ---- the new-type dialog: filters, then what they leave ---- */
const seg = (vals, on) => `<div class="nt-seg">${vals.map((v) => `<button class="${v === on ? 'is-on' : ''}">${v}</button>`).join('')}</div>`;
const all = e.PARTS.filter((p) => p.kind !== 'supply' && !p.discontinued);
const matches = all.filter((p) => p.common);   // nothing asked yet, so the usual parts
const dialogHtml = `<div class="nt-dialog" style="box-shadow:none;border:1px solid #dbe3ee">
  <div class="nt-head"><b>New driver type</b>
    <span class="text-secondary small">Common driver types</span>
    <button class="btn btn-sm btn-link ms-auto p-0">close</button></div>
  <div class="nt-filters">
    <div class="nt-filter"><span>Type</span>${seg(['CC', 'CV', 'any'], 'any')}</div>
    <label class="nt-filter"><span>Current ≥</span><input type="number" placeholder="mA"><em>mA</em></label>
    <label class="nt-filter"><span>Power ≥</span><input type="number" placeholder="W"><em>W</em></label>
    <div class="nt-filter"><span>Outputs</span>${seg(['1', '2', 'any'], 'any')}</div>
    <input class="form-control form-control-sm nt-q" placeholder="Filter by name…">
  </div>
  <div class="nt-list">${matches.map((p, i) => `<div class="nt-part${i === 0 ? ' is-on' : ''}">
    <span class="type-power is-${p.powerType.toLowerCase()}">${p.powerType}</span>
    <span class="nt-part-name">${esc(p.name)}</span>
    <span class="nt-part-spec">${p.maxPowerW != null ? fmt(p.maxPowerW) + 'W' : 'W set by the supply'}${p.minA != null ? ` · ${p.minA}–${p.maxA}A` : ''}${p.maxFvV != null ? ` · ${p.maxFvV}fV/out` : ''}</span>
    <span class="nt-part-ch">${p.outputs ?? 1} out</span></div>`).join('')}
    <button class="nt-more">See other driver types (${all.length - matches.length})</button></div>
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

const editor = `<div class="preset-editor" style="padding:0">
  <div class="fld-sec">Driver</div>
  <div class="fld-grid">
    <label class="fld"><span class="fld-col">Type</span><select><option>CC</option></select></label>
    <label class="fld is-off"><span class="fld-col">MaxPower(W)</span><input value="185">
      <button class="fld-ds">spec page: 30</button></label>
    <label class="fld"><span class="fld-col">CurrentRange</span><input value="1.05"></label>
    <label class="fld"><span class="fld-col">BallastCountPerUoM</span><input value="1"></label>
    <label class="fld"><span class="fld-col">ControlType</span><input value="DALI"></label>
  </div>
  <div class="fld-sec">Per output
    <span class="fld-sec-note">EldoLED SoloDrive 360/A runs 0.15–1.4A</span></div>
  <div class="fld-grid">
    <label class="fld"><span class="fld-col">Parameters</span><input value="1"></label>
    <label class="fld"><span class="fld-col">NodeMaxForwardVoltage(fV)</span><input placeholder="—">
      <button class="fld-ds">use 55</button></label>
    <label class="fld"><span class="fld-col">NodeMaxPower(W)</span><input placeholder="—"></label>
    <label class="fld"><span class="fld-col">NodeCurrent</span><input placeholder="—"></label>
  </div>
  <div class="fld-foot">
    <button class="btn btn-sm btn-primary">Save</button>
    <button class="btn btn-sm btn-link">Cancel</button>
    <span class="fld-foot-note">Saved here, and written to the workbook when you copy the patch</span>
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
<div class="mockhead">One screen. From a hub, each card gains an Add</div>
<div class="frame"><div class="types-page">
  <div class="dp-head">
    <button class="btn btn-sm btn-outline-secondary">← HUB-A</button>
    <h5 class="mb-0">Add a driver to HUB-A</h5>
    <span class="text-secondary small">${m.inventory.length} types available · ${inHub.size} already in HUB-A</span>
    <input class="form-control form-control-sm ms-auto" style="max-width:220px" placeholder="Filter…">
    <button class="btn btn-sm btn-primary">New type</button>
  </div>
  <div class="tp-grid">${pickerHtml}</div>
</div></div>

<div class="mockhead">The same screen on its own — no Add, flagged first</div>
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

<div class="mockhead">The warning, opened — with the fixes beside the reason</div>
${faultHtml}

<div class="mockhead">✎ — the card opens to every ElementTypes field</div>
<div class="frame"><div class="types-page"><div class="tp-grid"><div class="tp-card is-editing">
  <div class="tp-card-top"><span class="tp-ref">ET-CCR-D-1050-1CH-01</span></div>
  <div class="tp-line"><span class="type-power is-cc">CC</span>
    <span class="tp-name">EldoLED SOLODrive 360/A at 1050mA</span></div>
  <div class="tp-spec">185W · 1.05A</div>
  <div class="tp-foot"><span class="tp-use">1 × HUB-E</span>
    <button class="tp-icon"><span class="material-icons">close</span></button>
    <button class="tp-icon"><span class="material-icons">more_vert</span></button></div>
  ${editor}
</div></div></div></div>

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
