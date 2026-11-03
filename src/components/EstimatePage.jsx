import { useEffect, useMemo, useState } from 'react';
import * as api from '../api.js';
import { listSessions } from '../persist.js';
import { compareEstimate, ESTIMATE_WARNING, isFeed, estimatePatchRows, filterRequirements, filterValue, PIVOT_COLUMNS, generateEstimatePatch, isOwnLine, channelClass, resolveSpec, zoneViews } from '../engine.js';
import { effectiveDrivers } from '../state.js';
import { openReport } from '../bugReports.js';
import { isEmbedded } from '../embed.js';
import KebabMenu from './KebabMenu.jsx';
import Tooltip from './Tooltip.jsx';
import ViewToggle from './ViewToggle.jsx';

// Tender estimate - Positions rolled up by DJ 100053, no links and no drivers.
// There is nothing to assign here, so there is no tray and no bins: the question
// is only how many drivers of what, per hub, and the answer is a count you can
// patch in as Elements.

const fmt = (n) => (n == null ? null : (Number.isInteger(n) ? n : +n.toFixed(1)));

// Why a count is what it is, in the terms someone will argue with it in.
const LIMIT = {
  fV: { label: 'Voltage', icon: 'horizontal_align_right', blurb: 'Fittings on one output are in series, so their forward voltages add up. The output ran out of voltage before the driver ran out of watts, so the count is set by how many fit on each output.' },
  'node W': { label: 'Output watts', icon: 'horizontal_align_right', blurb: 'Each output has its own wattage cap, and that ran out before the voltage or the driver total did.' },
  'driver W': { label: 'Driver watts', icon: 'horizontal_align_right', blurb: "The driver's total wattage, less the spare margin, ran out first. Its outputs had voltage to spare." },
  outputs: { label: 'Outputs', icon: 'call_split', blurb: 'Groups that must stay on separate outputs ran out of outputs before the driver ran out of watts.' },
};

// line flags are icons; the only chips are the driver ElementType and the PositionTypes
// Material Symbols only, not in the Material Icons font this app ships
const SYMBOL = {
  horizontal_align_right: 'M760-160v-640h80v640h-80ZM480-280l-56-56 104-104H120v-80h408L424-624l56-56 200 200-200 200Z',
  tonality_2: 'M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm40-718v636q121-15 200.5-106T800-480q0-121-79.5-212T520-798Zm-80 38v-38q-30 5-59 13.5T326-760h114Zm0 120v-40H230q-8 9-14 19t-12 21h236Zm0 120v-40H170l-4 20-4 20h278Zm0 120v-40H162l4 20 4 20h270Zm0 120v-40H204q6 11 12 21t14 19h210Zm0 118v-38H326q26 16 55 24.5t59 13.5Zm80-318Z',
  instant_mix: 'M200-160v-280h-80v-80h240v80h-80v280h-80Zm0-440v-200h80v200h-80Zm160 0v-80h80v-120h80v120h80v80H360Zm80 440v-360h80v360h-80Zm240 0v-120h-80v-80h240v80h-80v120h-80Zm0-280v-360h80v360h-80Z',
};
// supplied marks: E in a triangle = emergency, orange asterisk = feed
const MARK = {
  // symbol_E on Material's 24 grid: teal triangle border, white inside, black E
  emergency: ['0 0 24 24', <>
    <path fill="#08a8ac" d="M12 1.5 23 21H1z" />
    <path fill="#fff" d="M12 5.6 19.56 19H4.44z" />
    <path fill="#000" d="M9.6 10.4h4.6v1.5h-3v1.4h2.7v1.4h-2.7v1.4h3v1.5H9.6z" />
  </>],
  feed: ['0 0 407 351', <path fill="#ff8200" d="M180 44H230V142L315 93L340 136L255 185L304 271L261 296L205 199L149 296L106 271L155 185L70 136L95 93L180 142Z" />],
};
const Icon = ({ name, cls, label }) => (MARK[name]
  ? <svg className={`est-ico est-svg ${cls}`} viewBox={MARK[name][0]} role="img" aria-label={label}>{MARK[name][1]}</svg>
  : SYMBOL[name]
  ? <svg className={`est-ico est-svg ${cls}`} viewBox="0 -960 960 960" role="img" aria-label={label}><path d={SYMBOL[name]} fill="currentColor" /></svg>
  : <span className={`material-icons est-ico ${cls}`} role="img" aria-label={label}>{name}</span>);
const PtChips = ({ pts }) => <span className="est-pills">{(pts?.length ? pts : ['-']).map((pt) => <span key={pt} className="est-pill est-pill-pt">{pt}</span>)}</span>;

const PICK_LABEL = { single: 'Single output', fewest: 'Fewest drivers', spareOutputs: 'Spare outputs' };

// [driver pref, output pref, label, singular, what ticking it means]
const SEPARATE = [
  ['restrictControlGroup', null, 'ControlGroups', 'ControlGroup', ['A ControlGroup is dimmed and switched as one.',
    ['Per driver:', 'a driver carries one ControlGroup.'],
    ['Per output:', 'always - an output is dimmed as one, so it can never carry two, though a 2-output driver can serve two groups.']]],
  ['splitByType', 'nodeSplitByType', 'Fitting types', 'fitting type', [
    ['Per driver:', 'fittings of different PositionTypes never share a driver.'],
    ['Per output:', 'never share an output, though a driver may carry one type per output.']]],
  ['splitByLocation', 'nodeSplitByLocation', 'Rooms', 'room', [
    ['Per driver:', 'a driver only serves one room.'],
    ['Per output:', 'each output serves one room, though a driver may serve one room per output.']]],
];
const PICK_INFO = ['Which driver type wins when several fit.',
  ['Single output:', 'the simplest part, leaving consolidation to the detail design.'],
  ['Fewest drivers:', 'the most efficient.'],
  ['Spare outputs:', 'room for fittings added late.'],
  'Emergency stock always loses.'];

// Load against the whole rating, the spare margin hatched at the end, so the
// bar's full width is the driver's real capacity (8WQAAN).
const LoadBar = ({ load, rated, keep }) => (
  <div className="est-bar">
    <i style={{ width: `${Math.min(100, Math.round((load / rated) * 100))}%` }} />
    {keep < 1 && <b className="est-spare" style={{ width: `${Math.round((1 - keep) * 100)}%` }} />}
  </div>
);

const Info = ({ text }) => (
  <Tooltip content={text}>
    <span className="material-icons est-info" tabIndex={0} aria-label={[text].flat(2).join(' ')}>info_outline</span>
  </Tooltip>
);

// How the patch lays out its rows. The choice is a pref, so it sticks across
// hubs and sessions; the preview is the rows the patch will append, as named.
const ROW_MODES = [
  [false, 'One row per type per hub', 'Quantity is the driver count. The Name lists every ControlGroup the row covers.'],
  [true, 'One row per driver', 'Quantity 1 each. Each Name lists the ControlGroups that driver carries - dealt out in order when groups share drivers.'],
];

// `others`: hubs saved in this branch+set (overlay only), ticked into the same patch.
function PatchDialog({ opts, zone, others, perDriver, onPerDriver, onCopy, onClose }) {
  const [estimates, setEstimates] = useState([]);
  const [picked, setPicked] = useState(() => new Set(others.map((s) => s.key)));
  useEffect(() => {
    let stale = false;
    Promise.all([api.estimate(opts, zone), api.estimateHubs(others.filter((s) => picked.has(s.key)), opts)])
      .then(([here, more]) => !stale && setEstimates([...here, ...more]));
    return () => { stale = true; };
  }, [JSON.stringify(opts), zone, picked]);
  const rows = estimatePatchRows(estimates, { perDriver });
  const tick = (key) => setPicked((p) => { const n = new Set(p); if (!n.delete(key)) n.add(key); return n; });

  return (
    <div className="nt-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fd-dialog est-patch" role="dialog" aria-label="Copy Elements patch">
        <div className="fd-head">
          <b>Copy Elements patch</b>
          <button className="btn btn-sm btn-link ms-auto p-0" onClick={onClose}>close</button>
        </div>
        <fieldset className="est-patch-modes">
          <legend>Rows</legend>
          {ROW_MODES.map(([v, label, help]) => (
            <label key={label}>
              <input type="radio" name="patch-rows" checked={perDriver === v} onChange={() => onPerDriver(v)} />
              <span><b>{label}</b><small>{help}</small></span>
            </label>
          ))}
        </fieldset>
        {others.length > 0 && (
          <fieldset className="est-patch-modes">
            <legend>Hubs</legend>
            <label><input type="checkbox" checked disabled /><span><b>{zone ?? 'This hub'}</b></span></label>
            {others.map((s) => (
              <label key={s.key}>
                <input type="checkbox" checked={picked.has(s.key)} onChange={() => tick(s.key)} />
                <span><b>{s.zones.join(', ')}</b></span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="est-patch-preview">
          <table className="table table-sm mb-0">
            <thead><tr><th>Name</th><th>ElementType</th><th>ContextRef</th><th>Quantity</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}><td>{r.name || <em className="text-secondary">blank</em>}</td>
                  <td><code>{r.typeRef}</code></td><td>{r.contextRef}</td><td>{r.quantity}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="fd-foot">
          <span className="est-meta">{rows.length} row{rows.length === 1 ? '' : 's'} appended, each needing a Ref</span>
          <button className="btn btn-sm btn-primary ms-auto" onClick={() => onCopy(generateEstimatePatch(estimates, { perDriver }))}
            disabled={!rows.length}>Copy patch</button>
        </div>
      </div>
    </div>
  );
}

export default function EstimatePage({ state, dispatch, zone }) {
  const { model, prefs } = state;
  const [zones, setZones] = useState([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [patchOpen, setPatchOpen] = useState(false);

  const opts = {
    restrictControlGroup: prefs.restrictControlGroup,
    splitByType: prefs.splitByType,
    splitByLocation: prefs.splitByLocation,
    nodeSplitByType: prefs.nodeSplitByType,
    nodeSplitByLocation: prefs.nodeSplitByLocation,
    pickBy: prefs.pickBy ?? (prefs.preferSingleOutput === false ? 'fewest' : 'single'),
    allowLocal: prefs.allowLocal,
    margin: prefs.margin,
    forced: state.forcedTypes,
    ownLine: state.ownLine,
    // the pivot filters an Excel user would set; the overlay sends one hub's rows already
    rowFilter: isEmbedded() ? null : state.rowFilter,
  };
  useEffect(() => {
    let stale = false;
    api.estimate(opts, zone).then((z) => !stale && setZones(z)).catch((e) => setError(e.message));
    return () => { stale = true; };
  }, [model, zone, prefs.restrictControlGroup, prefs.splitByType, prefs.splitByLocation,
      prefs.nodeSplitByType, prefs.nodeSplitByLocation, prefs.allowLocal, prefs.pickBy, prefs.preferSingleOutput, prefs.margin, state.forcedTypes, state.ownLine, state.rowFilter]);

  // Overlay: hubs estimated in other frames of this branch+set, not this one.
  const otherHubs = useMemo(() => {
    if (!patchOpen) return [];
    const here = new Set((model.requirements || []).map((r) => r.zone));
    return listSessions().map((s) => ({ ...s, zones: [...new Set((s.model.requirements || []).map((r) => r.zone))] }))
      .filter((s) => s.zones.some((z) => !here.has(z)));
  }, [patchOpen, model]);

  const setPref = (p) => dispatch({ type: 'SET_PREFS', prefs: p });
  const marginPct = Math.round((prefs.margin ?? 0) * 100);

  const totals = useMemo(() => {
    const byType = new Map();
    let drivers = 0;
    let unmatched = 0;
    let skipped = 0;
    for (const z of zones) {
      drivers += z.drivers;
      for (const u of z.unmatched) if (u.feed) continue; else if (u.skipped) skipped += u.qty; else unmatched += u.qty;
      for (const l of z.lines) byType.set(l.typeRef, (byType.get(l.typeRef) ?? 0) + l.count);
    }
    return { drivers, unmatched, skipped, byType: [...byType.entries()].sort() };
  }, [zones]);

  // Beside the hub's actual drivers, per type - only for one hub that has any.
  // An estimate-only hub has nothing to compare, and saying "0 in the hub" for
  // every type would read as a fault.
  const views = zone ? zoneViews(model, zone) : null;
  const compare = useMemo(() => {
    if (!zone || !views?.cables) return null;
    const hub = effectiveDrivers(model, state.addedDrivers, state.deletedDrivers).filter((d) => d.zone === zone);
    // nothing to compare against yet - silence, not a match or a fault
    if (!hub.length) return null;
    return compareEstimate(zones.find((z) => z.zone === zone), hub);
  }, [model, zone, zones, state.addedDrivers, state.deletedDrivers, views?.cables]);

  // A quantity is a count unless its PositionType states a UoM - 'm' for linear.
  // A line can sum rows of several types, so it only takes a unit they all share.
  const reqByRef = useMemo(() => new Map((model.requirements || []).map((r) => [r.ref, r])), [model]);
  const amount = (qty, refs) => {
    const units = new Set((refs ?? []).map((ref) => reqByRef.get(ref)?.uom ?? null));
    if (units.size > 1) return `${fmt(qty)} (mixed units)`;
    const [unit] = units;
    return unit ? `${fmt(qty)} ${unit}` : `qty ${fmt(qty)}`;
  };
  // '25 W per m' for strip, '25 W each' for a counted fitting (BERMQB)
  const unitOf = (refs) => {
    const units = new Set((refs ?? []).map((ref) => reqByRef.get(ref)?.uom ?? null));
    return units.size === 1 ? [...units][0] : null;
  };
  // the pivot's figures, from the assessment rows themselves
  const rowsOf = (refs) => (refs ?? []).map((ref) => reqByRef.get(ref)).filter(Boolean);
  const powerOf = (refs) => rowsOf(refs).reduce((n, r) => n + (r.loadW ?? 0), 0);
  // series volts of every CC fitting; none on CV, so no total
  const fvLabel = (refs) => {
    const rs = rowsOf(refs).filter((r) => r.fvPer != null);
    return rs.length ? `${fmt(rs.reduce((n, r) => n + r.fvPer * r.qty, 0))} V` : '–';
  };
  // a line serving several groups sits under all of them together: the driver is shared
  const cgOf = (l) => l.groupQty?.map(([g]) => g || '-').join(', ') || l.controlGroup
    || [...new Set(rowsOf(l.rows).map((r) => r.controlGroup || '-'))].join(', ') || '-';
  const groupsOf = (z) => {
    const m = new Map();
    const add = (l, unmatched) => {
      const cg = cgOf(l);
      if (!m.has(cg)) m.set(cg, { cg, g: `${z.zone}#${cg}`, items: [] });
      m.get(cg).items.push({ l, k: `${z.zone}|${l.key}`, unmatched });
    };
    z.lines.forEach((l) => add(l, false));
    z.unmatched.forEach((u) => add(u, true));
    return [...m.values()];
  };
  const unmatchedLabel = (skipped = false) => {
    const byUnit = new Map();
    for (const z of zones) {
      for (const u of z.unmatched.filter((x) => !x.feed && !!x.skipped === skipped)) {
        for (const ref of u.rows ?? []) {
          const r = reqByRef.get(ref);
          if (r) byUnit.set(r.uom ?? '', (byUnit.get(r.uom ?? '') ?? 0) + r.qty);
        }
      }
    }
    return [...byUnit].map(([unit, q]) => (unit ? `${fmt(q)} ${unit}` : `qty ${fmt(q)}`)).join(' + ');
  };

  // scoped to one hub when routed from the landing page, whole job otherwise
  const rows = zone ? model.requirements.filter((r) => r.zone === zone) : model.requirements;
  // a filter is only offered for a column this export has; values counted over the scope
  const columns = useMemo(() => [...new Set(rows.flatMap((r) => Object.keys(r.cols ?? {})))], [rows]);
  const pivots = PIVOT_COLUMNS.map((names) => names.find((c) => columns.includes(c))).filter(Boolean);
  const filters = opts.rowFilter ? [...new Set([...pivots, ...Object.keys(opts.rowFilter)])].map((col) => {
    const n = new Map();
    for (const r of rows) n.set(filterValue(r, col), (n.get(filterValue(r, col)) ?? 0) + 1);
    return [col, [...n].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))];
  }) : [];
  const filtersOn = Object.values(opts.rowFilter ?? {}).filter((vs) => vs?.length).length;
  const [bar, setBar] = useState(null); // which toolbar menu is open
  useEffect(() => {
    if (!bar) return undefined;
    const onDoc = (e) => { if (!e.target.closest?.('.hub-menuwrap')) setBar(null); };
    const onKey = (e) => { if (e.key === 'Escape') setBar(null); };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); window.removeEventListener('keydown', onKey); };
  }, [bar]);
  const menuButton = (id, icon, label, badge) => (
    <button type="button" className={`hub-tb ${bar === id ? 'is-open' : ''}`} aria-expanded={bar === id}
      onClick={() => setBar((o) => (o === id ? null : id))}>
      <span className="material-icons">{icon}</span>{label}
      {badge ? <span className="badge text-bg-primary">{badge}</span> : null}
      <span className="material-icons caret">expand_more</span>
    </button>
  );
  const hiddenRows = rows.length - filterRequirements(rows, opts.rowFilter).length;
  const posTypes = new Set(rows.map((r) => r.positionType).filter(Boolean));
  // a line opens to its rows, and its rows to the arithmetic behind the count
  const [open, setOpen] = useState(() => new Set());
  // one working at a time, in a dialog: several open inline was too busy (report TZY2VC)
  const [working, setWorking] = useState(null);
  // the driver type select stays out of the way until asked for from ⋮ (SSCMMX)
  const [forcing, setForcing] = useState(null);
  // one driver type for every line a PositionType is on (5SVFZX)
  const [forcingPt, setForcingPt] = useState(null);
  // now and then, so it is not wallpaper (5KEFGM)
  const [flash] = useState(() => Math.random() < 1 / 3);
  const toggle = (set, k) => set((p) => { const n = new Set(p); if (!n.delete(k)) n.add(k); return n; });
  // hub by hub: only standalone over the whole job - the overlay already sends one hub
  const canStep = !isEmbedded() && !zone && zones.length > 1;
  const [hubAt, setHubAt] = useState(0);
  const at = Math.min(hubAt, zones.length - 1);
  const shown = canStep && prefs.hubByHub ? zones.slice(at, at + 1) : zones;
  const lineKeys = shown.flatMap((z) => groupsOf(z).flatMap(({ g, items }) => [g, ...items.map((i) => i.k)]));

  // the line's rows are one channelClass (the engine splits on it); the popup is just the columns
  const ChannelIcon = ({ refs }) => {
    const rs = (refs ?? []).map((ref) => reqByRef.get(ref)).filter(Boolean);
    const c = rs.length ? channelClass(rs[0]) : null;
    if (!c) return null;
    const facts = [...new Set(rs.map((r) => `MAX_SecondaryPowerNodes ${r.nodes ?? '-'} · ControlAddressCount ${r.addressCount ?? '-'}`))];
    return (
      <Tooltip content={facts}>
        <Icon name={c === 'multi' ? 'instant_mix' : 'tonality_2'} cls={`est-ch-${c}`} label={facts.join('; ')} />
      </Tooltip>
    );
  };

  const RowTable = ({ refs }) => (
    <table className="est-rowtable">
      <thead><tr><th>PositionType</th><th>Room</th><th>ControlGroup</th><th className="text-end">Qty × W each</th><th>Drive</th><th /></tr></thead>
      <tbody>
        {refs.map((ref) => reqByRef.get(ref)).filter(Boolean).map((r) => {
          const part = resolveSpec(r.positionType);
          const u = r.uom ? ` ${r.uom}` : '';
          return (
            <tr key={r.ref} data-code={r.ref}>
              <td className="est-type">{r.positionType}{part && <small>{part.name}</small>}</td>
              <td>{r.location}</td>
              <td className="est-mono">{r.controlGroup}</td>
              <td className="est-load">{fmt(r.qty)}{u} × {fmt(r.wPer)} W{r.uom ? `/${r.uom}` : ''} = <b>{fmt(r.loadW)} W</b></td>
              <td>
                <span className={`est-drive is-${(r.powerType ?? '').toLowerCase()}`}>
                  {!r.powerType ? 'no CC/CV' : r.powerType === 'CV' ? `CV ${r.voltageV ?? ''} V`
                    : `CC ${r.currentA != null ? `${Math.round(r.currentA * 1000)} mA` : '?'}${r.fvPer != null ? ` · ${fmt(r.fvPer)} V` : ''}`}
                </span>
              </td>
              <td className="text-end">
                <KebabMenu title="Row actions" items={[...(r.positionType && !prefs.splitByType ? [{
                  label: isOwnLine(r.positionType, state.ownLine)
                    ? `Bundle ${r.positionType} again` : `Own line for every ${r.positionType}`,
                  onClick: () => dispatch({ type: 'OWN_LINE', positionType: r.positionType }),
                }] : []), ...(r.positionType ? [{
                  label: `Driver type for every ${r.positionType}`, icon: 'swap_horiz',
                  onClick: () => setForcingPt(r.positionType),
                }] : []), {
                  label: 'Report an issue', icon: 'flag',
                  onClick: (e) => openReport(e.currentTarget.closest('tr')),
                }]} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  // Every driver type in the library, the ones that fit these fittings first.
  // Anything may be forced: an emergency driver, or a case-by-case call.
  const driverTypes = useMemo(() => (model.inventory ?? []).filter((t) => t.nodes?.length)
    .map((t) => t.typeRef).sort(), [model]);
  const ForceType = ({ k, l }) => {
    const fits = l.fitTypes ?? [];
    const auto = l.considered?.find((c) => c.auto)?.typeRef;
    return (
      <label className="est-force" onClick={(e) => e.stopPropagation()}>
        Driver type
        <select className="form-select form-select-sm" value={state.forcedTypes[k] ?? ''}
          onChange={(e) => dispatch({ type: 'FORCE_TYPE', key: k, typeRef: e.target.value || null })}>
          <option value="">Automatic{auto ? ` - ${auto}` : ''}</option>
          {fits.length > 0 && <optgroup label="Fits these fittings">
            {fits.map((t) => <option key={t} value={t}>{t}</option>)}
          </optgroup>}
          <optgroup label={l.feed ? 'Sized by watts only' : 'Does not match - will be flagged'}>
            {driverTypes.filter((t) => !fits.includes(t)).map((t) => <option key={t} value={t}>{t}</option>)}
          </optgroup>
        </select>
      </label>
    );
  };

  const ForcePositionType = ({ pt }) => {
    const ptsOf = (l) => l.positionTypes ?? (l.rows ?? []).map((ref) => reqByRef.get(ref)?.positionType);
    const lines = zones.flatMap((z) => [...z.lines, ...z.unmatched.filter((u) => !u.skipped || u.key.startsWith('no-power-type'))]
      .filter((l) => ptsOf(l).includes(pt)).map((l) => ({ k: `${z.zone}|${l.key}`, l })));
    const fits = driverTypes.filter((t) => lines.every(({ l }) => (l.fitTypes ?? []).includes(t)));
    const now = new Set(lines.map(({ k }) => state.forcedTypes[k] ?? ''));
    const mixed = lines.filter(({ l }) => ptsOf(l).some((x) => x && x !== pt)).length;
    const close = () => setForcingPt(null);
    return (
      <div className="nt-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
        <div className="fd-dialog" role="dialog" aria-label={`Driver type for every ${pt}`}>
          <div className="fd-head">
            <b>Driver type for every {pt}</b>
            <button className="btn btn-sm btn-link ms-auto p-0" onClick={close}>close</button>
          </div>
          <label className="est-force">
            {lines.length} line{lines.length === 1 ? '' : 's'}
            <select className="form-select form-select-sm" value={now.size === 1 ? [...now][0] : ''}
              onChange={(e) => {
                dispatch({ type: 'FORCE_TYPE', keys: lines.map(({ k }) => k), typeRef: e.target.value || null });
                close();
              }}>
              <option value="">Automatic</option>
              {fits.length > 0 && <optgroup label="Fits every line">
                {fits.map((x) => <option key={x} value={x}>{x}</option>)}
              </optgroup>}
              <optgroup label={isFeed(pt) ? 'Sized by watts only' : 'Does not match every line - will be flagged'}>
                {driverTypes.filter((x) => !fits.includes(x)).map((x) => <option key={x} value={x}>{x}</option>)}
              </optgroup>
            </select>
          </label>
          {mixed > 0 && <small className="text-secondary">{mixed} of these also carr{mixed === 1 ? 'ies' : 'y'} other fitting types, which change with it.</small>}
        </div>
      </div>
    );
  };

  // The engine's own inputs, laid out as the sum a person would check by hand.
  const Working = ({ l, zone: z, k }) => {
    const w = l.working;
    if (!w) return null;
    const n = w.outputs;
    const unit = unitOf(l.rows);
    const each = unit ? `per ${unit}` : 'each';
    const W = unit ? `W/${unit}` : 'W';
    const step = (label, body, note, cls = '') => (
      <div className={`est-step${cls}`}>
        <span className="est-step-l">{label}</span>
        <span>{body}</span>
        {note && <small>{note}</small>}
      </div>
    );
    const cap = l.count * w.maxPowerW * w.keep;
    const pct = Math.round((l.loadW / cap) * 100);
    // per-driver load: the packer's own split, or fill order for plain division; grouped runs have none
    const dCap = w.packing?.dCap ?? w.maxPowerW * w.keep;
    const split = w.packing ? w.packing.drivers.map((d) => d.w)
      : !w.runList && !w.packed && w.wPer ? Array.from({ length: l.count }, (_, i) => Math.min(l.perDriver, l.qty - i * l.perDriver) * w.wPer)
      : null;
    const report = (e) => openReport(e.currentTarget.closest('td'), {
      // allowlisted: refs and numbers only, no location names
      estimate: {
        zone: z, typeRef: l.typeRef, count: l.count, qty: l.qty, perDriver: l.perDriver, outputs: l.outputs,
        perNode: l.perNode, limit: l.limit, loadW: l.loadW, controlGroup: l.controlGroup,
        positionTypes: l.positionTypes, rows: l.rows, working: w, forced: l.forced, mismatch: l.mismatch,
        // the forced map's keys can carry room names
        opts: { ...opts, forced: undefined },
      },
    });
    // Left to right, with a fork wherever the engine chose: the options stack in
    // one column, the one taken drawn solid and the rest faded.
    const fork = (title, branches) => (branches.length === 1
      ? step(branches[0].label, branches[0].body, branches[0].note, branches[0].cls ?? '')
      : (
        <div className="est-fork">
          <span className="est-fork-l">{title}</span>
          {branches.map((b) => (
            <div key={b.key} className={b.taken ? '' : `est-off${b.pick ? ' est-take' : ''}`}
              {...(b.pick && { role: 'button', tabIndex: 0, title: 'Use this driver type', onClick: b.pick,
                onKeyDown: (e) => (e.key === 'Enter' || e.key === ' ') && b.pick() })}>
              {step(b.label, b.body, b.note, b.taken ? b.cls ?? '' : '')}
            </div>
          ))}
        </div>
      ));
    const arr = <span className="est-arr">→</span>;
    const byOutputs = w.runList ? Math.ceil(l.outputs / n) : null;
    return (
      <div className="est-working">
        {w.fittings?.length > 1
          ? fork(`Fittings, each whole${w.mixed ? ' and packed at its own size' : ''}`, w.fittings.map((f, i) => ({
            key: i, taken: true, label: f.positionType || '-',
            body: `${amount(f.qty, f.refs)} · ${fmt(f.wPer)} W ${unitOf(f.refs) ? `per ${unitOf(f.refs)}` : 'each'}${f.fvPer ? ` · ${fmt(f.fvPer)} V each` : ''}`,
          })))
          : step('Fittings', `${l.positionTypes?.length ? `${l.positionTypes.join(', ')} · ` : ''}${amount(l.qty, l.rows)} · ${fmt(w.wPer)} W ${each}${w.fvPer ? ` · ${fmt(w.fvPer)} V each` : ''}`,
            'each one whole: never split across outputs or drivers')}
        {arr}
        {l.forcedIssue && <>{step('Forced type not used', l.forcedIssue, 'sized on the automatic pick instead', ' warn')}{arr}</>}
        {l.considered?.length > 1 && <>
          {fork(`Driver type, ${l.forced && !l.forcedIssue ? 'forced on this line' : `by ${PICK_LABEL[opts.pickBy]?.toLowerCase() ?? 'fit'}`}`,
            l.considered.map((c) => ({
              key: c.typeRef, taken: c.taken, cls: c.mismatch ? ' run warn' : ' run',
              pick: c.taken ? null : () => dispatch({ type: 'FORCE_TYPE', key: k, typeRef: c.auto ? null : c.typeRef }),
              label: `${c.typeRef}${c.em ? ' (EM)' : ''}`,
              body: c.count == null ? 'not sized'
                : <>{c.count} × {c.outputs}-output · {c.spareOutputs} spare output{c.spareOutputs === 1 ? '' : 's'}</>,
              note: c.mismatch ? `forced - does not match: ${c.mismatch}`
                : c.taken && !c.auto ? `forced · ${c.spareW} W spare`
                  : c.auto ? (c.taken ? `chosen · ${c.spareW} W spare` : `the automatic pick by ${PICK_LABEL[opts.pickBy]?.toLowerCase()}`)
                    : `lost on ${c.lostOn}`,
            })))}
          {arr}
        </>}
        {step(`Driver, less ${Math.round((1 - w.keep) * 100)}% spare`,
          `${fmt(w.maxPowerW * w.keep)} W · ${n} output${n === 1 ? '' : 's'}${w.maxFvV ? ` · ${fmt(w.maxFvV * w.keep)} V each` : ''}`,
          `${l.name} · rated ${w.maxPowerW} W${w.maxFvV ? `, ${w.maxFvV} V` : ''}`)}
        {arr}
        {w.packing ? fork('Packed largest first: each fitting goes on the first output with room for its volts and watts',
          w.packing.drivers.flatMap((d) => d.outs).map((o) => {
            const { fvCap, wCap } = w.packing;
            const sum = (k, unit) => `${o.items.length > 1 ? `${o.items.map((it) => fmt(it[k])).join(' + ')} = ` : ''}${fmt(o[k])} ${unit}`;
            const { least } = o;
            const roomV = fvCap != null ? fvCap - o.fv : Infinity;
            const roomW = wCap - o.w;
            const why = least.fv > roomV ? `${fmt(least.fv)} V` : least.w > roomW ? `${fmt(least.w)} W` : null;
            return {
              key: `${o.driver}.${o.output}`, taken: true, cls: ' run',
              label: `Driver ${o.driver}${n > 1 ? `, output ${o.output}` : ''}${o.run ? ` · ${o.run}` : ''}`,
              body: <>
                <div>{o.items.map((it) => `${it.pt ?? '-'}${it.q < 1 ? ` (${fmt(it.q)})` : ''}`).join(' + ')}</div>
                {fvCap != null && o.fv > 0 && <div>{sum('fv', 'V')} of {fmt(fvCap)} V</div>}
                <div>{sum('w', 'W')} of {fmt(wCap)} W</div>
              </>,
              note: why
                ? `${fmt(roomV === Infinity ? null : roomV) ?? '-'} V, ${fmt(roomW)} W left - the smallest fitting here (${least.pt ?? '-'}) needs ${why}`
                : 'room left, but every fitting is placed',
            };
          })) : w.runList ? <>
          {fork('Each group on its own outputs', w.runList.map((r) => ({
            key: r.label, taken: true, cls: ' run',
            label: r.label || '-',
            body: <>{fmt(r.qty)} ÷ {r.per}{r.qty % r.per ? ' ↑' : ''} = <b>{r.outputs}</b> output{r.outputs === 1 ? '' : 's'}</>,
            note: `${r.per} per output at ${fmt(r.wPer)} ${W}${r.fvPer ? `, ${fmt(r.fvPer)} V` : ''} each`,
          })))}
          {arr}
          {fork('Enough drivers for both', [
            { key: 'o', taken: byOutputs >= w.byWatts, cls: ' bind', label: 'By outputs',
              body: <>{l.outputs} ÷ {n}{l.outputs % n ? ' ↑' : ''} = <b>{byOutputs}</b></> },
            { key: 'w', taken: w.byWatts > byOutputs, cls: ' bind', label: 'By driver watts',
              body: <>{fmt(l.qty)} ÷ {w.perDriverW}{l.qty % w.perDriverW ? ' ↑' : ''} = <b>{w.byWatts}</b></>,
              note: `${w.perDriverW} whole ${unit ? unit : 'fittings'} per driver: ${fmt(w.maxPowerW * w.keep)} W ÷ ${fmt(w.wPer)} ${W}` },
          ])}
        </> : fork('Per driver, the tightest limit', [
          w.perNodeFv != null && { key: 'fV', taken: l.limit === 'fV', cls: ' bind', label: 'Per output by voltage',
            body: <>{fmt(w.maxFvV * w.keep)} V ÷ {fmt(w.fvPer)} V = <b>{w.perNodeFv}</b></>,
            note: n > 1 ? `× ${n} outputs = ${w.perNodeFv * n}` : null },
          w.perNodeW != null && { key: 'nW', taken: l.limit === 'node W', cls: ' bind', label: 'Per output by watts',
            body: <>{fmt(w.maxLoadW * w.keep)} W ÷ {fmt(w.wPer)} {W} = <b>{w.perNodeW}</b></>,
            note: n > 1 ? `× ${n} outputs = ${w.perNodeW * n}` : null },
          { key: 'dW', taken: l.limit === 'driver W', cls: ' bind', label: 'Per driver by watts',
            body: <>{fmt(w.maxPowerW * w.keep)} W ÷ {fmt(w.wPer)} {W} = <b>{w.perDriverW}</b></> },
        ].filter(Boolean))}
        {arr}
        {step('Drivers', w.runList || w.packed
          ? <><b>{l.count}</b> × {l.typeRef}</>
          : <>{fmt(l.qty)} ÷ {l.perDriver}{l.qty % l.perDriver ? ' ↑' : ''} = <b>{l.count}</b></>,
        w.packing ? (n > 1
          ? w.packing.drivers.map((d, i) => `driver ${i + 1}: ${d.outs.length} of ${n} outputs, ${fmt(d.w)} of ${fmt(w.packing.dCap)} W`).join(' · ')
          : `one output each, within ${fmt(w.packing.dCap)} W`)
          : w.runList ? `${w.runs} groups kept on separate outputs` : `${l.perDriver} per driver`, ' result')}
        {split && split.length > 1 && split.map((wd, i) => (
          <div className="est-usage" key={i}>
            <LoadBar load={wd} rated={w.maxPowerW} keep={w.keep} />
            <span>Driver {i + 1}: {fmt(wd)} W of {fmt(dCap)} W · {fmt(w.maxPowerW)} W rated</span>
          </div>
        ))}
        <div className="est-usage">
          <LoadBar load={l.loadW} rated={l.count * w.maxPowerW} keep={w.keep} />
          <span>{fmt(l.loadW)} W of {fmt(cap)} W usable · {fmt(l.count * w.maxPowerW)} W rated · {pct}% loaded</span>
          <button type="button" className="btn btn-sm btn-link est-flag" onClick={report}
            title="Send this working with a note about what is wrong">
            <span className="material-icons">flag</span> Calculation looks wrong
          </button>
        </div>
      </div>
    );
  };

  const TypePill = ({ t }) => <span className="est-pill est-pill-type">{t}</span>;
  const reasonOf = (u) => (u.feed ? 'No driver' : u.reason ?? 'No ElementType in the DesignDB can take these');
  const canForce = (u) => !u.skipped || u.key.startsWith('no-power-type');

  // the cells after the label, for one line or one unmatched lot
  const LineCells = ({ l, k, unmatched, zone: z }) => {
    const lim = LIMIT[l.limit];
    return <>
      <td className="n">{fmt(unmatched ? powerOf(l.rows) : l.loadW)} W</td>
      <td className="n">{fvLabel(l.rows)}</td>
      <td>{unmatched ? <span className={l.feed ? 'pv-note' : 'dp-fault'}>{reasonOf(l)}</span> : <TypePill t={l.typeRef} />}</td>
      <td className="n">{unmatched ? '–' : l.count}</td>
      <td className="pv-flags">
        <ChannelIcon refs={l.rows} />
        {!l.forced && l.positionTypes?.some((pt) => /Em?$/.test(pt) && isOwnLine(pt, state.ownLine)) && (
          <Tooltip content={[['May be emergency', ''], `${l.positionTypes.filter((pt) => /Em?$/.test(pt)).join(', ')} ends in E or Em, so it may be an emergency fitting and has its own line. If it is, change the driver type (⋮) to an emergency driver.`]}>
            <Icon name="emergency" cls="est-em" label="May be emergency" />
          </Tooltip>
        )}
        {l.positionTypes?.length > 0 && l.positionTypes.every(isFeed) && <Tooltip content="Feed"><Icon name="feed" cls="est-feed" label="Feed" /></Tooltip>}
        {l.forced && (
          <Tooltip content={[['Forced', ''], l.mismatch ? `Does not match: ${l.mismatch}` : l.forcedIssue ?? 'On this line instead of the automatic pick.']}>
            <Icon name={l.mismatch || l.forcedIssue ? 'report_problem' : 'push_pin'} cls={`est-forced${l.mismatch || l.forcedIssue ? ' bad' : ''}`} label="Forced" />
          </Tooltip>
        )}
      </td>
      <td className="pv-lim">
        {!unmatched && (
          <Tooltip content={[[`${lim?.label ?? l.limit} limited`, ''], lim?.blurb].filter(Boolean)}>
            <span><Icon name={lim?.icon ?? 'help_outline'} cls={`est-lim-${l.limit.replace(' ', '')}`} label={`${lim?.label ?? l.limit} limited`} /> {lim?.label ?? l.limit}</span>
          </Tooltip>
        )}
      </td>
      <td className="text-end" data-code={l.typeRef}>
        {!unmatched && <KebabMenu title="Line actions" items={[...(l.working ? [{
          label: `How ${l.count} was worked out`, icon: 'calculate',
          onClick: () => setWorking(k),
        }] : []), {
          label: 'Change driver type', icon: 'swap_horiz',
          onClick: () => { setForcing(k); if (!open.has(k)) toggle(setOpen, k); },
        }]} />}
        {working === k && (
          <div className="nt-backdrop text-start" onClick={(e) => e.target === e.currentTarget && setWorking(null)}>
            <div className="fd-dialog est-working-dialog" role="dialog" aria-label="How the count was worked out">
              <div className="fd-head">
                <b>How {l.count} × {l.typeRef} was worked out</b>
                <button className="btn btn-sm btn-link ms-auto p-0" onClick={() => setWorking(null)}>close</button>
              </div>
              <Working l={l} zone={z} k={k} />
            </div>
          </div>
        )}
      </td>
    </>;
  };

  const Detail = ({ l, k, unmatched }) => (
    <tr className="pv-detail">
      <td colSpan={8}>
        <div className="est-body">
          {(unmatched ? canForce(l) : forcing === k || state.forcedTypes[k]) && <ForceType k={k} l={l} />}
          <RowTable refs={l.rows ?? []} />
          {!unmatched && !l.working && <div className="est-howto">Sized by watts: {fmt(l.loadW)} W</div>}
        </div>
      </td>
    </tr>
  );

  const copyPatch = async (script) => {
    setError(null);
    try {
      await api.copyPatch(script);
      setPatchOpen(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setError(e.message || 'Could not copy');
    }
  };

  const exportCsv = async () => {
    const rows = [['Hub', 'ElementTypeRef', 'Quantity', 'Fittings', 'Load (W)', 'Limited by']];
    for (const z of zones) {
      for (const l of z.lines) rows.push([z.zone, l.typeRef, l.count, l.qty, fmt(l.loadW), l.limit]);
    }
    // last, so the header stays the first row for anything that reads this back
    rows.push([], ['NOTE', ESTIMATE_WARNING]);
    const csv = rows.map((r) => r.map((v) => `"${String(v ?? '')}"`).join(',')).join('\r\n');
    const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    await api.saveCsv(`${csv}\r\n`, `DriverEstimate-${stamp}.csv`);
  };

  return (
    <div className="container-fluid py-3 drivers-page">
      {/* one slim row like the hub layout's; each menu makes the estimate looser,
          and the count higher. All off is the tightest answer, rarely the one to price. */}
      <div className="hub-bar est-bar-top" data-debug-id="estimate-options">
        {filters.length > 0 && (
          <span className="hub-menuwrap">
            {menuButton('filter', 'filter_alt', 'Filter', filtersOn)}
            {bar === 'filter' && (
              <div className="hub-menu is-wide est-filters">
                {filters.map(([col, values]) => {
                  const off = opts.rowFilter?.[col] ?? [];
                  const shown = values.filter(([v]) => !off.includes(v)).length;
                  const set = (vs) => dispatch({ type: 'SET_ROW_FILTER', field: col, values: vs });
                  return (
                    <details key={col} className="est-filter" ref={(el) => { if (el && off.length) el.open = true; }}>
                      <summary>
                        <span className="grow">{col}</span>
                        <b>{shown === values.length ? 'All' : `${shown} of ${values.length}`}</b>
                        {!pivots.includes(col) && (
                          <button type="button" className="btn-close btn-sm ms-1" aria-label={`Remove the ${col} filter`}
                            onClick={(e) => { e.preventDefault(); set(null); }} />
                        )}
                      </summary>
                      <div className="est-filter-vals">
                        {/* like Excel: ticks or clears every value, part-ticked when some are off */}
                        <label className="hub-mi">
                          <input type="checkbox" className="form-check-input m-0" checked={off.length === 0}
                            ref={(el) => { if (el) el.indeterminate = off.length > 0 && shown > 0; }}
                            onChange={() => set(off.length === 0 ? values.map(([v]) => v) : [])} />
                          <span className="grow">(Select All)</span>
                        </label>
                        {values.map(([v, n]) => (
                          <label key={v} className="hub-mi">
                            <input type="checkbox" className="form-check-input m-0" checked={!off.includes(v)}
                              onChange={(e) => set(e.target.checked ? off.filter((x) => x !== v) : [...off, v])} />
                            <span className="grow rv-ref">{v || '(blank)'}</span><span className="hint">{n}</span>
                          </label>
                        ))}
                      </div>
                    </details>
                  );
                })}
                <div className="hub-mdiv" />
                <div className="hub-mi">
                  <span className="material-icons">add</span>
                  <select className="form-select form-select-sm" value="" aria-label="Filter on another column"
                    onChange={(e) => e.target.value && dispatch({ type: 'SET_ROW_FILTER', field: e.target.value, values: [] })}>
                    <option value="">Add column…</option>
                    {columns.filter((c) => !filters.some(([f]) => f === c)).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            )}
          </span>
        )}

        <span className="hub-menuwrap">
          {menuButton('separate', 'call_split', 'Keep separate')}
          {bar === 'separate' && (
            <div className="hub-menu is-wide">
        <table className="est-grid">
          <thead><tr><th /><th>per driver</th><th>per output</th></tr></thead>
          <tbody>
            {SEPARATE.map(([dk, nk, label, what, info]) => (
              <tr key={dk}>
                <td>{label} <Info text={info} /></td>
                <td>
                  <input type="checkbox" aria-label={`${label} apart per driver`} checked={!!prefs[dk]}
                    title={`Never put two ${what}s on one driver`}
                    onChange={(e) => setPref({ [dk]: e.target.checked })} />
                </td>
                <td>
                  {/* no output pref: always apart, never a choice */}
                  <input type="checkbox" aria-label={`${label} apart per output`}
                    checked={!nk || !!prefs[dk] || !!prefs[nk]} disabled={!nk || !!prefs[dk]}
                    title={!nk ? `Always: an output can never carry two ${what}s`
                      : prefs[dk] ? `Implied: a driver already carries one ${what}` : `Never put two ${what}s on one output`}
                    onChange={(e) => setPref({ [nk]: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
            </div>
          )}
        </span>

        <span className="hub-menuwrap">
          {menuButton('types', 'tune', 'Driver types')}
          {bar === 'types' && (
            <div className="hub-menu is-wide">
        <label className="est-c">
          Pick by
          <select className="form-select form-select-sm est-pick" value={opts.pickBy}
            onChange={(e) => setPref({ pickBy: e.target.value })}>
            {Object.entries(PICK_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <Info text={PICK_INFO} />
        </label>
        <label className="est-c">
          <input type="checkbox" checked={!!prefs.allowLocal}
            onChange={(e) => setPref({ allowLocal: e.target.checked })} />
          Allow Local drivers
          <Info text="Local drivers are switched and unaddressed. Unless this is on, they are left out of sizing, and flagged if a hub already has one." />
        </label>
        <label className="est-c">
          Spare
          <input type="number" className="form-control form-control-sm margin-input"
            min="0" max="50" step="1" value={marginPct}
            onChange={(e) => setPref({ margin: Math.min(50, Math.max(0, Number(e.target.value) || 0)) / 100 })} />
          %
          <Info text={`Capacity left free on every driver and output, for late changes. At ${marginPct}% each is filled to ${100 - marginPct}% of its rating.`} />
        </label>
            </div>
          )}
        </span>

        <span className="hub-menuwrap">
          {menuButton('view', 'visibility', 'View')}
          {bar === 'view' && (
            <div className="hub-menu">
              <button type="button" className="hub-mi" onClick={() => { setOpen(new Set(lineKeys)); setBar(null); }}>
                <span className="material-icons">unfold_more</span><span className="grow">Expand all rows</span>
              </button>
              <button type="button" className="hub-mi" onClick={() => { setOpen(new Set()); setBar(null); }}>
                <span className="material-icons">unfold_less</span><span className="grow">Collapse all rows</span>
              </button>
              {canStep && <>
                <div className="hub-mdiv" />
                <label className="hub-mi">
                  <input type="checkbox" className="form-check-input m-0" checked={!!prefs.hubByHub}
                    onChange={(e) => setPref({ hubByHub: e.target.checked })} />
                  <span className="grow">One hub at a time</span>
                </label>
              </>}
            </div>
          )}
        </span>

        {canStep && prefs.hubByHub && (
          <span className="est-step-hubs">
            <button type="button" className="hub-tb" disabled={at === 0} aria-label="Previous hub"
              onClick={() => setHubAt(at - 1)}><span className="material-icons">chevron_left</span></button>
            <select className="form-select form-select-sm" value={at} aria-label="Hub"
              onChange={(e) => setHubAt(Number(e.target.value))}>
              {zones.map((z, i) => <option key={z.zone} value={i}>{z.zone}</option>)}
            </select>
            <span className="est-meta">{at + 1} of {zones.length}</span>
            <button type="button" className="hub-tb" disabled={at === zones.length - 1} aria-label="Next hub"
              onClick={() => setHubAt(at + 1)}><span className="material-icons">chevron_right</span></button>
          </span>
        )}

        <span className="flex-grow-1" />
        <button type="button" className="hub-tb" onClick={exportCsv}>
          <span className="material-icons">download</span>Export CSV
        </button>
        <button type="button" className="hub-tb is-solid" onClick={() => setPatchOpen(true)}
          title="An ExcelScript that appends these drivers to the Elements sheet">
          <span className="material-icons">{copied ? 'check' : 'content_copy'}</span>{copied ? 'Copied' : 'Copy Elements patch…'}
        </button>
      </div>

      <div className="est-top">
      <div className="est-summary">
      <div className="dp-head">
        <h5 className="mb-0">Secondary Power Assessment</h5>
        {zone && <span className="est-hub">{zone}</span>}
        {zone && <ViewToggle model={model} zone={zone} current="estimate" dispatch={dispatch} />}
        {/* An early design has hubs and Elements but no cables: the space layout is
            still where they are arranged, so the quiet way in is here too. */}
        {zone && (
          <button type="button" className="space-link" title="Hub layout" aria-label="Open the hub layout"
            onClick={() => dispatch({ type: 'SET_VIEW', view: { page: 'layout', zone, from: 'estimate' } })}>
            <span className="material-icons">straighten</span>
          </button>
        )}
        {totals.unmatched > 0 && (
          <span className="dp-need" title="No ElementType in the DesignDB can take these, so no driver is counted for them">
            {unmatchedLabel()} unmatched
          </span>
        )}
        {hiddenRows > 0 && (
          <span className="dp-need" title="Left out by the Filter menu - they are not in this estimate">
            {hiddenRows} row(s) filtered out
          </span>
        )}
        {totals.skipped > 0 && (
          <span className="dp-need" title="Rows with no CC/CV SecondaryPowerType or no power - no driver is sized for them. Open the grey lines to see which.">
            {unmatchedLabel(true)} not sized
          </span>
        )}
      </div>
      <div className="est-meta">
        {rows.length} row{rows.length === 1 ? '' : 's'} · {posTypes.size} PositionType{posTypes.size === 1 ? '' : 's'}
        {zone ? '' : ` · ${zones.length} hub${zones.length === 1 ? '' : 's'}`}
        {views?.cables ? '' : ' · no links yet'}
      </div>

      <div className="est-hero">
        <div className="est-big">{totals.drivers}<small>driver{totals.drivers === 1 ? '' : 's'}</small></div>
        {totals.byType.map(([t, n]) => <span key={t} className="est-chip"><b>{n}</b> × {t}</span>)}
      </div>

      {/* the patch appends rows it cannot ref; that is the next job */}
      {totals.drivers > 0 && <div className="est-meta mb-2">Patch drivers get no Ref: give each appended row one before committing.</div>}

      {forcingPt && <ForcePositionType pt={forcingPt} />}

      {patchOpen && (
        <PatchDialog opts={opts} zone={zone} others={otherHubs} perDriver={!!prefs.patchPerDriver}
          onPerDriver={(v) => setPref({ patchPerDriver: v })}
          onCopy={copyPatch} onClose={() => setPatchOpen(false)} />
      )}

      {/* Always shown, never dismissable: the count is a starting point. */}
      <div className={`est-warn${flash ? ' is-flash' : ''}`} role="note">
        <span className="material-icons">warning</span>
        <div><strong>Check every calculation.</strong> {ESTIMATE_WARNING}</div>
      </div>
      </div>

      </div>

      {zone && !rows.length && (
        <div className="alert alert-secondary py-2 small">
          No assessment rows for {zone}. The host sends them from the hub's Positions (DJ 100053) - if
          this hub has Positions, the DataJoin overlay may be out of date.
        </div>
      )}

      {/* only ever a flag: agreement is the expected case and says nothing */}
      {compare?.mismatch && rows.length > 0 && (
        <div className="alert alert-danger py-2 small">
          <strong>Estimate and hub disagree</strong>
          {' - '}estimate {compare.rows.reduce((n, r) => n + r.estimate, 0)} driver(s),
          hub has {compare.rows.reduce((n, r) => n + r.hub, 0)}.
          <ul className="mb-0 mt-1">
            {compare.rows.filter((r) => r.estimate !== r.hub).map((r) => (
              <li key={r.typeRef}>
                <code>{r.typeRef}</code>: estimate {r.estimate}, hub {r.hub}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <div className="alert alert-danger py-2 mt-2">{error}</div>}

      {/* a pivot: Hub > ControlGroup, the totals as values, the driver as helper columns */}
      <div className="est-pivot-wrap mt-3">
        <table className="est-pivot">
          <thead>
            <tr>
              <th>Hub / ControlGroup</th><th className="n">Total Power</th><th className="n">Total Forward Voltage</th>
              <th>Driver Type</th><th className="n">Driver Count</th><th>Flags</th><th>Limited By</th><th />
            </tr>
          </thead>
          {shown.map((z) => {
            const groups = groupsOf(z);
            const hubTypes = new Set(z.lines.map((l) => l.typeRef));
            return (
              <tbody key={z.zone}>
                <tr className="pv-hub">
                  <td>{z.zone}</td><td className="n">{fmt(z.loadW)} W</td><td />
                  <td>{hubTypes.size === 1 ? <TypePill t={[...hubTypes][0]} /> : null}</td>
                  <td className="n">{z.drivers}</td><td /><td /><td />
                </tr>
                {groups.map(({ cg, g, items }) => {
                  const one = items.length === 1 ? items[0] : null;
                  const isOpen = open.has(one ? one.k : g);
                  const refs = items.flatMap((i) => i.l.rows ?? []);
                  const matched = items.filter((i) => !i.unmatched);
                  const types = [...new Set(matched.map((i) => i.l.typeRef))];
                  const typeCell = one ? null : !matched.length ? <span className="pv-note">{reasonOf(items[0].l)}</span>
                    : types.length === 1
                      ? <><TypePill t={types[0]} /> <span className="pv-note">· {items.length} lines{prefs.splitByType ? ', fitting types kept apart' : ''}</span></>
                      : <span className="pv-note">Mixed: {types.join(', ')}</span>;
                  return [
                    <tr key={g} className={`pv-cg${one?.unmatched && !one.l.feed ? ' is-off' : ''}${isOpen ? ' open' : ''}`}>
                      <td>
                        <button type="button" className="pv-toggle" aria-expanded={isOpen}
                          onClick={() => toggle(setOpen, one ? one.k : g)}>
                          <span className="est-caret">{isOpen ? '▾' : '▸'}</span>{cg}
                        </button>
                      </td>
                      {one ? <LineCells {...one} zone={z.zone} /> : <>
                        <td className="n">{fmt(powerOf(refs))} W</td>
                        <td className="n">{fvLabel(refs)}</td>
                        <td>{typeCell}</td>
                        <td className="n">{matched.reduce((n, i) => n + i.l.count, 0) || '–'}</td>
                        <td /><td /><td />
                      </>}
                    </tr>,
                    one && isOpen && <Detail key={`${g}-d`} {...one} />,
                    ...(!one && isOpen ? items.flatMap((i) => [
                      <tr key={i.k} className={`pv-line${i.unmatched && !i.l.feed ? ' is-off' : ''}${open.has(i.k) ? ' open' : ''}`}>
                        <td>
                          <button type="button" className="pv-toggle" aria-expanded={open.has(i.k)} onClick={() => toggle(setOpen, i.k)}>
                            <span className="est-caret">{open.has(i.k) ? '▾' : '▸'}</span>
                            {i.unmatched && !i.l.feed ? amount(i.l.qty, i.l.rows) : <PtChips pts={i.l.positionTypes} />}
                          </button>
                        </td>
                        <LineCells {...i} zone={z.zone} />
                      </tr>,
                      open.has(i.k) && <Detail key={`${i.k}-d`} {...i} />,
                    ]) : []),
                  ];
                })}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}
