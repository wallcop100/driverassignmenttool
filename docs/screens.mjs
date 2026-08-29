// Renders each of the tool's surfaces to standalone HTML for the docs, using the
// real demo model, the real engine, and the app's own stylesheet — so a
// screenshot is of what the code produces, not of a drawing of it.
//
//   node docs/screens.mjs
//
// Writes docs/driver-types.html and docs/estimate.html. Open each and capture.
// There is no headless browser in this repo, so the capture itself is manual;
// regenerating after a UI change is not.
import fs from 'node:fs';
import * as e from '../src/engine.js';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const m = e.buildModel(
  fs.readFileSync(`${root}/src/demo/form.csv`, 'utf8'),
  fs.readFileSync(`${root}/src/demo/links.csv`, 'utf8'),
);
const fmt = (n) => (n == null ? null : (Number.isInteger(n) ? n : +n.toFixed(2)));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// usage per type, as the page computes it
const usage = new Map();
for (const d of m.drivers) {
  const c = usage.get(d.typeRef) ?? { count: 0, zones: new Set() };
  c.count += 1; if (d.zone) c.zones.add(d.zone); usage.set(d.typeRef, c);
}
// group by part
const by = new Map(); const orphans = [];
for (const t of m.inventory) {
  const spec = e.resolveSpec(t.name || t.typeRef);
  const part = spec?.driver ?? spec;
  if (!part) { orphans.push(t); continue; }
  if (!by.has(part.name)) by.set(part.name, { key: part.name, part, spec, types: [] });
  by.get(part.name).types.push({ t, spec });
}
for (const p of e.PARTS) {
  if (p.kind === 'supply' || by.has(p.name)) continue;
  by.set(p.name, { key: p.name, part: p, spec: p, types: [] });
}
const list = [...by.values()].sort((a, b) => a.key.localeCompare(b.key));

// The part is matched on a free-text name, so a mismatch might be the match's
// fault rather than the data's. Attribute the number to the spec page instead of
// asserting it, and lean on the part name in the row above rather than repeating
// it — the tooltip carries the full sentence, match included.
const faults = (t, spec) => {
  const out = [];
  if (t.maxPowerW == null) {
    out.push(['no MaxPower(W) — nothing to size against',
      'Without a max power this type cannot be checked or sized against.']);
  } else if (spec?.maxPowerW != null && Math.abs(t.maxPowerW - spec.maxPowerW) > 0.01) {
    const times = t.maxPowerW / spec.maxPowerW;
    out.push([`${t.maxPowerW}W here · spec page says ${fmt(spec.maxPowerW)}W`,
      `This type states ${t.maxPowerW}W. The ${spec.name} spec page says ${fmt(spec.maxPowerW)}W`
      + `${times >= 1.5 ? ` — ${fmt(times)}× higher, so checks against it would pass an overload` : ''}. `
      + 'If this is not a ' + spec.name + ', the name is what matched it.']);
  }
  if (t.powerType === 'CC' && t.currentA == null) {
    out.push(['no CurrentRange — reads as undeclared',
      'With CurrentRange empty the driver has no declared CC/CV type, so it matches no cable.']);
  } else if (t.powerType === 'CC' && t.currentA != null && spec?.minA != null
    && (t.currentA < spec.minA || t.currentA > spec.maxA)) {
    out.push([`${t.currentA}A · spec page range is ${spec.minA}–${spec.maxA}A`,
      `${t.currentA}A is outside the ${spec.minA}–${spec.maxA}A the ${spec.name} spec page gives.`]);
  }
  return out;
};

const rating = (t) => (t.powerType === 'CC' && t.currentA != null ? `${t.currentA}A`
  : t.powerType === 'CV' && t.outputVoltageV != null ? `${t.outputVoltageV}V` : null);

const EXT = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3h-7zM5 5h5V3H3v18h18v-7h-2v5H5V5z"/></svg>';

const OPEN = 'EldoLED SoloDrive 360/A';   // one row shown expanded
// Still in the data, no longer specified. Kept so existing refs resolve, hidden
// from the add list.
const DISCONTINUED = new Set(e.PARTS.filter((x) => x.discontinued).map((x) => x.name));

const rows = list.map((g) => {
  const p = g.part; const s = g.spec ?? p;
  const eff = p.kind === 'dcdc' ? (g.types.length ? s : p) : p;
  const open = p.name === OPEN;
  const gone = DISCONTINUED.has(p.name);
  if (gone && !g.types.length) return '';   // nothing uses it and you can't buy it
  const troubled = g.types.some(({ t, spec }) => faults(t, spec).length);
  const head = `<button type="button" class="dp-part-head">
      <span class="type-power is-${p.powerType.toLowerCase()}">${p.powerType}</span>
      <span class="dp-name">${esc(p.name)}${gone ? '<span class="dp-gone">discontinued</span>' : ''}</span>
      <span class="dp-spec">${fmt(eff.maxPowerW)}W${p.powerType === 'CC' && p.minA != null ? ` · ${p.minA === p.maxA ? p.minA + 'A' : p.minA + '–' + p.maxA + 'A'}` : ''}${eff.outputV != null ? ` · ${eff.outputV}V` : ''}${eff.maxFvV != null ? ` · ${eff.maxFvV}fV/out` : ''}</span>
      <span class="dp-ch">${eff.outputs ?? 1} out${eff.addresses ? ` · ${eff.addresses}CH` : ''}</span>
      ${troubled ? '<span class="dp-flag" title="One of the types under this part is worth a look">!</span>' : ''}
      <span class="dp-count">${g.types.length ? g.types.length + ' in use' : ''}</span>
    </button>`;
  const refs = !open ? '' : g.types.map(({ t, spec }) => {
    const f = faults(t, spec); const u = usage.get(t.typeRef);
    return `<div class="dp-ref${f.length ? ' is-off' : ''}">
      <span class="dp-ref-id">${esc(t.typeRef)}</span>
      <span class="dp-ref-spec">${t.maxPowerW != null ? t.maxPowerW + 'W' : '—'}${rating(t) ? ' · ' + rating(t) : ''}${t.nodes[0]?.maxFvV != null ? ' · ' + t.nodes[0].maxFvV + 'fV' : ''}</span>
      <span class="dp-ref-use">${u ? u.count + ' driver' + (u.count > 1 ? 's' : '') + ' · ' + [...u.zones].sort().join(', ') : 'unused'}</span>
      ${f.length ? `<span class="dp-fault" title="${f.map((x) => x[1]).join(' · ')}">${f.map((x) => x[0]).join(' · ')}</span>` : ''}
      <span class="dp-ref-act"><button class="btn btn-sm btn-link p-0 me-2">add to HUB-B1</button><button class="btn btn-sm btn-link p-0">edit</button></span>
    </div>`;
  }).join('');
  const add = open ? `<div class="dp-add">
      <label><span>CurrentRange</span><input class="form-control form-control-sm" type="number" placeholder="0.15–1.4" value="0.35"></label>
      <span class="dp-newref">ET-CCR-D-350-1CH-01</span>
      <button class="btn btn-sm btn-primary ms-auto">Add to HUB-B1</button>
      <button class="btn btn-sm btn-link">edit values</button>
    </div>` : '';
  return `<div class="dp-part${open ? ' is-open' : ''}${gone ? ' is-gone' : ''}">${head}${refs}${add}</div>`;
}).join('');

const orphanHtml = orphans.length ? `<div class="dp-sub">No datasheet</div>` + orphans.map((t) => {
  const u = usage.get(t.typeRef);
  return `<div class="dp-ref is-plain"><span class="dp-ref-id">${esc(t.typeRef)}</span>
    <span class="dp-ref-spec">${esc(t.name || '—')}</span>
    <span class="dp-ref-use">${u ? u.count + ' drivers' : 'unused'}</span>
    <span class="dp-ref-act"><button class="btn btn-sm btn-link p-0 me-2">add to HUB-B1</button><button class="btn btn-sm btn-link p-0">edit</button></span></div>`;
}).join('') : '';

const editor = `<div class="preset-editor px-3 py-3">
  <div class="spec-pick">
    <label><span>Part</span><select class="form-select form-select-sm"><option>EldoLED LinearDrive 220D</option></select></label>
    <label><span>Supply</span><select class="form-select form-select-sm"><option>Meanwell HLG-185-24</option></select></label>
  </div>
  <div class="spec-ref"><input value="ET-CVR-D-24-2CH-01"></div>
  <div class="spec-row"><span class="spec-group">Driver</span>
    <div class="spec-cell"><select><option>CV</option></select><span class="col">Type</span></div>
    <div class="spec-cell"><input value="180" class="is-off"><span class="col">MaxPower(W)</span><span class="ds">datasheet 185</span></div>
    <div class="spec-cell"><input value="24"><span class="col">OutputVoltage(V)</span></div>
    <div class="spec-cell"><input value="2"><span class="col">BallastCountPerUoM</span></div>
    <div class="spec-cell"><input value="DALI"><span class="col">ControlType</span></div>
  </div>
  <div class="spec-row"><span class="spec-group">Per output</span>
    <div class="spec-cell"><input value="2"><span class="col">Parameters</span></div>
    <div class="spec-cell"><input placeholder="—"><span class="col">NodeMaxForwardVoltage(fV)</span></div>
    <div class="spec-cell"><input placeholder="—"><span class="col">NodeMaxPower(W)</span></div>
    <div class="spec-cell"><input placeholder="—"><span class="col">NodeCurrent</span></div>
  </div>
  <div class="preset-note">EldoLED LinearDrive 220D + Meanwell HLG-185-24 · 185W at 24V</div>
  <div class="d-flex gap-2 mt-3 align-items-center">
    <button class="btn btn-sm btn-primary">Save</button>
    <button class="btn btn-sm btn-outline-secondary">Cancel</button>
    <span class="badge text-bg-warning ms-auto">provisional</span>
  </div>
</div>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Driver UI as it stands</title>
<style>${fs.readFileSync(`${root}/node_modules/bootstrap/dist/css/bootstrap.min.css`, 'utf8')}</style>
<style>${fs.readFileSync(`${root}/src/styles.css`, 'utf8')}</style>
<style>
.dp-part-head .type-power{min-width:40px;padding:3px 9px;font-size:11px;letter-spacing:.04em;border-radius:4px}
.dp-count{min-width:56px;text-align:right;margin-right:0}
.dp-gone{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;border:1px solid #dbe3ee;border-radius:3px;padding:1px 5px;margin-left:8px;font-weight:400}
.dp-part.is-gone .dp-name,.dp-part.is-gone .dp-spec,.dp-part.is-gone .dp-ch{color:#94a3b8}
.dp-need{font-size:12px;color:#8a6d1f;background:#fdf6e3;border:1px solid #e2d7b4;border-radius:4px;padding:2px 8px}
.dp-fault{color:#8a6d1f;border-bottom:1px dotted #c9a227;cursor:help}
body{padding:24px;background:#f6f8fb}.mockhead{font:600 12px/1.4 system-ui;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;margin:26px 0 8px}
.frame{background:#fff;border:1px solid #dbe3ee;border-radius:10px;overflow:hidden}</style>
</head><body>
<div class="mockhead">Driver types — reached from a hub (Add driver / Types)</div>
<div class="frame"><div class="container-fluid py-3 drivers-page">
  <div class="dp-head">
    <button class="btn btn-sm btn-outline-secondary">← HUB-B1</button>
    <h5 class="mb-0">Add drivers to HUB-B1</h5>
    <span class="text-secondary small">${m.inventory.length} in this job · ${e.PARTS.length} on datasheet</span>
    <span class="dp-need" title="These types have no ratings, so nothing can be sized against them">2 types need ratings</span>
    <input class="form-control form-control-sm ms-auto" style="max-width:240px" placeholder="Filter…">
  </div>
  <div class="dp-suggest"><div><b>HUB-B1 has 26 cables and no drivers yet</b>
    <div class="text-secondary small">4 × ET-CVR-D-24-2CH-01 would hold them, one ControlGroup each</div></div>
    <button class="btn btn-sm btn-primary ms-auto">Add these 4 drivers</button></div>
  <div class="dp-list">${rows}${orphanHtml}</div>
</div></div>
<div class="mockhead">The field editor, behind “edit” on a row</div>
<div class="frame">${editor}</div>
</body></html>`;
fs.writeFileSync(new URL('./driver-types.html', import.meta.url), html);
console.log('rows:', list.length, 'orphans:', orphans.length);

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
    <span class="text-secondary small">${f1(units)} units · ${em.zones.length} hubs · no links yet</span>
    <label class="small d-flex align-items-center gap-1 mb-0 ms-auto">Margin
      <input type="number" class="form-control form-control-sm margin-input" value="5">%</label>
  </div>
  <div class="est-constraints"><span class="est-c-label">Keep separate</span>${boxes}
    <span class="est-c-label ms-3">Choosing a part</span>
    <label class="est-c"><input type="checkbox" checked>Prefer single output</label></div>
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
        <span class="dp-ref-spec">${f1(l.qty)} units · ${l.perDriver} per driver${l.perNode ? ` · ${l.perNode} per output` : ''}</span>
        <span class="dp-ref-use">${l.limit} limited</span>
        <span class="dp-ref-use">${esc(l.controlGroup || '—')}</span></div>`).join('')}
      ${z.unmatched.map((u) => `<div class="dp-ref is-off"><span class="dp-ref-id">${f1(u.qty)} units</span>
        <span class="dp-fault">${esc(u.reason ?? 'no type in the library can take these')} — ${esc(u.key)}</span></div>`).join('')}
    </div>`).join('')}</div>
</div></div>
</body></html>`;
fs.writeFileSync(new URL('./estimate.html', import.meta.url), estHtml);
console.log('estimate:', zones.reduce((n, z) => n + z.drivers, 0), 'drivers over', zones.length, 'hubs');
