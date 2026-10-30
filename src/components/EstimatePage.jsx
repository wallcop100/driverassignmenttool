import { useEffect, useMemo, useState } from 'react';
import * as api from '../api.js';
import { compareEstimate, ESTIMATE_WARNING, isOwnLine, resolveSpec, zoneViews } from '../engine.js';
import { effectiveDrivers } from '../state.js';
import { openReport } from '../bugReports.js';
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
  fV: { label: 'Voltage', blurb: 'Fittings on one output are in series, so their forward voltages add up. The output ran out of voltage before the driver ran out of watts, so the count is set by how many fit on each output.' },
  'node W': { label: 'Output watts', blurb: 'Each output has its own wattage cap, and that ran out before the voltage or the driver total did.' },
  'driver W': { label: 'Driver watts', blurb: "The driver's total wattage, less the spare margin, ran out first. Its outputs had voltage to spare." },
  outputs: { label: 'Outputs', blurb: 'Groups that must stay on separate outputs ran out of outputs before the driver ran out of watts.' },
};

const PICK_LABEL = { single: 'Single output', fewest: 'Fewest drivers', spareOutputs: 'Spare outputs' };

// [driver pref, output pref, label, singular, what ticking it means]
const SEPARATE = [
  ['restrictControlGroup', null, 'ControlGroups', 'ControlGroup',
    'A ControlGroup is dimmed and switched as one. Per driver: a driver carries one ControlGroup. Per output: always - an output is dimmed as one, so it can never carry two, though a 2-output driver can serve two groups.'],
  ['splitByType', 'nodeSplitByType', 'Fitting types', 'fitting type',
    'Per driver: fittings of different PositionTypes never share a driver. Per output: never share an output, though a driver may carry one type per output.'],
  ['splitByLocation', 'nodeSplitByLocation', 'Rooms', 'room',
    'Per driver: a driver only serves one room. Per output: each output serves one room, though a driver may serve one room per output.'],
];

const Info = ({ text }) => (
  <Tooltip content={text}>
    <span className="material-icons est-info" tabIndex={0} aria-label={text}>info_outline</span>
  </Tooltip>
);

// How the patch lays out its rows. The choice is a pref, so it sticks across
// hubs and sessions; the preview is the rows the patch will append, as named.
const ROW_MODES = [
  [false, 'One row per type per hub', 'Quantity is the driver count. The Name lists every ControlGroup the row covers.'],
  [true, 'One row per driver', 'Quantity 1 each. Each Name lists the ControlGroups that driver carries - dealt out in order when groups share drivers.'],
];

function PatchDialog({ opts, zone, perDriver, onPerDriver, onCopy, onClose }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let stale = false;
    api.estimatePatchRows(opts, zone, { perDriver }).then((r) => !stale && setRows(r));
    return () => { stale = true; };
  }, [JSON.stringify(opts), zone, perDriver]);

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
          <button className="btn btn-sm btn-primary ms-auto" onClick={onCopy} disabled={!rows.length}>Copy patch</button>
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
  };
  useEffect(() => {
    let stale = false;
    api.estimate(opts, zone).then((z) => !stale && setZones(z)).catch((e) => setError(e.message));
    return () => { stale = true; };
  }, [model, zone, prefs.restrictControlGroup, prefs.splitByType, prefs.splitByLocation,
      prefs.nodeSplitByType, prefs.nodeSplitByLocation, prefs.allowLocal, prefs.pickBy, prefs.preferSingleOutput, prefs.margin, state.forcedTypes, state.ownLine]);

  const setPref = (p) => dispatch({ type: 'SET_PREFS', prefs: p });
  const marginPct = Math.round((prefs.margin ?? 0) * 100);

  const totals = useMemo(() => {
    const byType = new Map();
    let drivers = 0;
    let unmatched = 0;
    for (const z of zones) {
      drivers += z.drivers;
      unmatched += z.unmatched.reduce((n, u) => n + u.qty, 0);
      for (const l of z.lines) byType.set(l.typeRef, (byType.get(l.typeRef) ?? 0) + l.count);
    }
    return { drivers, unmatched, byType: [...byType.entries()].sort() };
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
  const unmatchedLabel = () => {
    const byUnit = new Map();
    for (const z of zones) {
      for (const u of z.unmatched) {
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
  const posTypes = new Set(rows.map((r) => r.positionType).filter(Boolean));
  // a line opens to its rows, and its rows to the arithmetic behind the count
  const [open, setOpen] = useState(() => new Set());
  // one working at a time, in a dialog: several open inline was too busy (report TZY2VC)
  const [working, setWorking] = useState(null);
  // the driver type select stays out of the way until asked for from ⋮ (SSCMMX)
  const [forcing, setForcing] = useState(null);
  const toggle = (set, k) => set((p) => { const n = new Set(p); if (!n.delete(k)) n.add(k); return n; });

  const RowTable = ({ refs }) => (
    <table className="est-rowtable">
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
                  {r.powerType === 'CV' ? `CV ${r.voltageV ?? ''} V`
                    : `CC ${r.currentA != null ? `${Math.round(r.currentA * 1000)} mA` : '?'}${r.fvPer != null ? ` · ${fmt(r.fvPer)} V` : ''}`}
                </span>
              </td>
              <td className="text-end">
                <KebabMenu title="Row actions" items={[...(r.positionType && !prefs.splitByType ? [{
                  label: isOwnLine(r.positionType, state.ownLine)
                    ? `Bundle ${r.positionType} again` : `Own line for every ${r.positionType}`,
                  onClick: () => dispatch({ type: 'OWN_LINE', positionType: r.positionType }),
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
          <optgroup label="Fits these fittings">
            {fits.map((t) => <option key={t} value={t}>{t}</option>)}
          </optgroup>
          <optgroup label="Does not match - will be flagged">
            {driverTypes.filter((t) => !fits.includes(t)).map((t) => <option key={t} value={t}>{t}</option>)}
          </optgroup>
        </select>
      </label>
    );
  };

  // The engine's own inputs, laid out as the sum a person would check by hand.
  const Working = ({ l, zone: z }) => {
    const w = l.working;
    if (!w) return null;
    const n = w.outputs;
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
    const report = (e) => openReport(e.currentTarget.closest('.est-line'), {
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
            <div key={b.key} className={b.taken ? '' : 'est-off'}>{step(b.label, b.body, b.note, b.taken ? b.cls ?? '' : '')}</div>
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
            body: `${amount(f.qty, f.refs)} · ${fmt(f.wPer)} W each${f.fvPer ? ` · ${fmt(f.fvPer)} V each` : ''}`,
          })))
          : step('Fittings', `${l.positionTypes?.length ? `${l.positionTypes.join(', ')} · ` : ''}${amount(l.qty, l.rows)} · ${fmt(w.wPer)} W each${w.fvPer ? ` · ${fmt(w.fvPer)} V each` : ''}`,
            'each one whole: never split across outputs or drivers')}
        {arr}
        {l.forcedIssue && <>{step('Forced type not used', l.forcedIssue, 'sized on the automatic pick instead', ' warn')}{arr}</>}
        {l.considered?.length > 1 && <>
          {fork(`Driver type, ${l.forced && !l.forcedIssue ? 'forced on this line' : `by ${PICK_LABEL[opts.pickBy]?.toLowerCase() ?? 'fit'}`}`,
            l.considered.map((c) => ({
              key: c.typeRef, taken: c.taken, cls: c.mismatch ? ' run warn' : ' run',
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
            note: `${r.per} per output at ${fmt(r.wPer)} W${r.fvPer ? `, ${fmt(r.fvPer)} V` : ''} each`,
          })))}
          {arr}
          {fork('Enough drivers for both', [
            { key: 'o', taken: byOutputs >= w.byWatts, cls: ' bind', label: 'By outputs',
              body: <>{l.outputs} ÷ {n}{l.outputs % n ? ' ↑' : ''} = <b>{byOutputs}</b></> },
            { key: 'w', taken: w.byWatts > byOutputs, cls: ' bind', label: 'By driver watts',
              body: <>{fmt(l.qty)} ÷ {w.perDriverW}{l.qty % w.perDriverW ? ' ↑' : ''} = <b>{w.byWatts}</b></>,
              note: `${w.perDriverW} whole fittings per driver: ${fmt(w.maxPowerW * w.keep)} W ÷ ${fmt(w.wPer)} W` },
          ])}
        </> : fork('Per driver, the tightest limit', [
          w.perNodeFv != null && { key: 'fV', taken: l.limit === 'fV', cls: ' bind', label: 'Per output by voltage',
            body: <>{fmt(w.maxFvV * w.keep)} V ÷ {fmt(w.fvPer)} V = <b>{w.perNodeFv}</b></>,
            note: n > 1 ? `× ${n} outputs = ${w.perNodeFv * n}` : null },
          w.perNodeW != null && { key: 'nW', taken: l.limit === 'node W', cls: ' bind', label: 'Per output by watts',
            body: <>{fmt(w.maxLoadW * w.keep)} W ÷ {fmt(w.wPer)} W = <b>{w.perNodeW}</b></>,
            note: n > 1 ? `× ${n} outputs = ${w.perNodeW * n}` : null },
          { key: 'dW', taken: l.limit === 'driver W', cls: ' bind', label: 'Per driver by watts',
            body: <>{fmt(w.maxPowerW * w.keep)} W ÷ {fmt(w.wPer)} W = <b>{w.perDriverW}</b></> },
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
            <div className="est-bar"><i style={{ width: `${Math.min(100, Math.round(wd / dCap * 100))}%` }} /></div>
            <span>Driver {i + 1}: {fmt(wd)} W of {fmt(dCap)} W</span>
          </div>
        ))}
        <div className="est-usage">
          <div className="est-bar"><i style={{ width: `${Math.min(100, pct)}%` }} /></div>
          <span>{fmt(l.loadW)} W of {fmt(cap)} W usable · {pct}% loaded</span>
          <button type="button" className="btn btn-sm btn-link est-flag" onClick={report}
            title="Send this working with a note about what is wrong">
            <span className="material-icons">flag</span> Calculation looks wrong
          </button>
        </div>
      </div>
    );
  };

  const copyPatch = async () => {
    setError(null);
    try {
      await api.copyPatch(await api.generateEstimatePatch(opts, zone, { perDriver: !!prefs.patchPerDriver }));
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

      <div className="est-actions">
        <button className="btn btn-sm btn-outline-secondary" onClick={exportCsv}>Export CSV</button>
        <button className="btn btn-sm btn-primary" onClick={() => setPatchOpen(true)}
          title="An ExcelScript that appends these drivers to the Elements sheet">
          {copied ? 'Copied!' : 'Copy Elements patch…'}
        </button>
        {/* the patch appends rows it cannot ref; that is the next job */}
        {totals.drivers > 0 && (
          <span className="est-meta">then give each appended row a Ref before committing</span>
        )}
      </div>

      {patchOpen && (
        <PatchDialog opts={opts} zone={zone} perDriver={!!prefs.patchPerDriver}
          onPerDriver={(v) => setPref({ patchPerDriver: v })}
          onCopy={copyPatch} onClose={() => setPatchOpen(false)} />
      )}

      {/* Always shown, never dismissable: the count is a starting point. */}
      <div className="est-warn" role="note">
        <span className="material-icons">warning</span>
        <div><strong>Check every calculation.</strong> {ESTIMATE_WARNING}</div>
      </div>
      </div>

      {/* Each of these makes the estimate looser, and the count higher. Turning
          them all off gives the tightest possible answer, which is rarely the
          one to price at tender. */}
      <aside className="est-assume" data-debug-id="estimate-options">
        <div className="est-c-label">Keep separate</div>
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

        <div className="est-c-label mt-3">Driver type restrictions</div>
        <label className="est-c">
          Pick by
          <select className="form-select form-select-sm est-pick" value={opts.pickBy}
            onChange={(e) => setPref({ pickBy: e.target.value })}>
            {Object.entries(PICK_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <Info text="Which driver type wins when several fit. Single output: the simplest part, leaving consolidation to the detail design. Fewest drivers: the most efficient. Spare outputs: room for fittings added late. Emergency stock always loses." />
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
      </aside>
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

      <div className="dp-list mt-3">
        {zones.map((z) => (
          <div key={z.zone} className="dp-part">
            <div className="dp-part-head" style={{ cursor: 'default' }}>
              <span className="dp-name">{z.zone}</span>
              <span className="dp-spec">{fmt(z.loadW)}W</span>
              <span className="dp-count">{z.drivers} driver{z.drivers === 1 ? '' : 's'}</span>
            </div>
            {z.lines.map((l) => {
              const k = `${z.zone}|${l.key}`;
              const isOpen = open.has(k);
              return (
                <div key={l.key} className={`est-line${isOpen ? ' open' : ''}`} data-debug-id="estimate-line" data-code={l.typeRef}>
                  <div className="dp-ref est-line-head" role="button" aria-expanded={isOpen} onClick={() => toggle(setOpen, k)}>
                    <span className="est-caret">{isOpen ? '▾' : '▸'}</span>
                    <span className="dp-ref-id">{l.count} × {l.typeRef}</span>
                    <span className="dp-ref-spec">
                      {l.positionTypes?.join(', ') || '-'} · {amount(l.qty, l.rows)} · {fmt(l.loadW)} W
                    </span>
                    <Tooltip content={LIMIT[l.limit]?.blurb ?? `Limited by ${l.limit}`}>
                      <span className={`est-lim est-lim-${l.limit.replace(' ', '')}`}>{LIMIT[l.limit]?.label ?? l.limit} limited</span>
                    </Tooltip>
                    {l.forced && (
                      <Tooltip content={l.mismatch ? `Forced, and does not match: ${l.mismatch}` : l.forcedIssue ?? `Forced on this line instead of the automatic pick`}>
                        <span className={`est-lim est-forced${l.mismatch || l.forcedIssue ? ' bad' : ''}`}>{l.mismatch || l.forcedIssue ? '⚠ forced' : 'forced'}</span>
                      </Tooltip>
                    )}
                    <span className="dp-ref-use">{l.groupQty?.map(([g]) => g || '-').join(', ') || l.controlGroup || '-'}</span>
                    <span className="est-nrows">{l.rows.length} row{l.rows.length === 1 ? '' : 's'}</span>
                    <KebabMenu title="Line actions" items={[{
                      label: 'Change driver type', icon: 'swap_horiz',
                      onClick: () => { setForcing(k); if (!isOpen) toggle(setOpen, k); },
                    }]} />
                  </div>
                  {isOpen && (
                    <div className="est-body">
                      {(forcing === k || state.forcedTypes[k]) && <ForceType k={k} l={l} />}
                      <RowTable refs={l.rows} />
                      <div className="est-howto" role="button" onClick={() => setWorking(k)}>
                        ▸ How {l.count} was worked out
                      </div>
                      {working === k && (
                        <div className="nt-backdrop" onClick={(e) => e.target === e.currentTarget && setWorking(null)}>
                          <div className="fd-dialog est-working-dialog" role="dialog" aria-label="How the count was worked out">
                            <div className="fd-head">
                              <b>How {l.count} × {l.typeRef} was worked out</b>
                              <button className="btn btn-sm btn-link ms-auto p-0" onClick={() => setWorking(null)}>close</button>
                            </div>
                            <Working l={l} zone={z.zone} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {z.unmatched.map((u) => {
              const k = `${z.zone}|${u.key}`;
              const isOpen = open.has(k);
              return (
                <div key={u.key} className={`est-line${isOpen ? ' open' : ''}`} data-debug-id="estimate-unmatched">
                  <div className="dp-ref is-off est-line-head" role="button" aria-expanded={isOpen} onClick={() => toggle(setOpen, k)}>
                    <span className="est-caret">{isOpen ? '▾' : '▸'}</span>
                    <span className="dp-ref-id">{amount(u.qty, u.rows)}</span>
                    <span className="dp-fault">{u.reason ?? 'No ElementType in the DesignDB can take these'}</span>
                  </div>
                  {isOpen && <div className="est-body"><ForceType k={k} l={u} /><RowTable refs={u.rows ?? []} /></div>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
