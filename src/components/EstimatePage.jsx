import { useEffect, useMemo, useState } from 'react';
import * as api from '../api.js';
import { compareEstimate, ESTIMATE_WARNING, resolveSpec, zoneViews } from '../engine.js';
import { effectiveDrivers } from '../state.js';
import { openReport } from '../bugReports.js';
import KebabMenu from './KebabMenu.jsx';
import ViewToggle from './ViewToggle.jsx';

// Tender estimate - Positions rolled up by DJ 100053, no links and no drivers.
// There is nothing to assign here, so there is no tray and no bins: the question
// is only how many drivers of what, per hub, and the answer is a count you can
// patch in as Elements.

const fmt = (n) => (n == null ? null : (Number.isInteger(n) ? n : +n.toFixed(1)));

// Why a count is what it is, in the terms someone will argue with it in.
const WHY = {
  fV: 'forward voltage per output',
  'node W': 'watts per output',
  'driver W': 'watts per driver',
};

export default function EstimatePage({ state, dispatch, zone }) {
  const { model, prefs } = state;
  const [zones, setZones] = useState([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  const opts = {
    restrictControlGroup: prefs.restrictControlGroup,
    splitByType: prefs.splitByType,
    splitByLocation: prefs.splitByLocation,
    nodeControlGroup: prefs.nodeControlGroup,
    nodeSplitByType: prefs.nodeSplitByType,
    nodeSplitByLocation: prefs.nodeSplitByLocation,
    preferSingleOutput: prefs.preferSingleOutput,
    allowLocal: prefs.allowLocal,
    margin: prefs.margin,
  };
  useEffect(() => {
    let stale = false;
    api.estimate(opts, zone).then((z) => !stale && setZones(z)).catch((e) => setError(e.message));
    return () => { stale = true; };
  }, [model, zone, prefs.restrictControlGroup, prefs.splitByType, prefs.splitByLocation,
      prefs.nodeControlGroup, prefs.nodeSplitByType, prefs.nodeSplitByLocation, prefs.allowLocal, prefs.preferSingleOutput, prefs.margin]);

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
  // which driver each assessment row ended up on
  const servedBy = useMemo(() => {
    const m = new Map();
    for (const z of zones) {
      for (const l of z.lines) for (const ref of l.rows ?? []) m.set(ref, l.typeRef);
      for (const u of z.unmatched) for (const ref of u.rows ?? []) m.set(ref, null);
    }
    return m;
  }, [zones]);

  // click a header to sort the assessment rows; again to reverse
  const [sort, setSort] = useState({ key: null, dir: 1 });
  const sortBy = (key) => setSort((p) => (p.key === key ? { key, dir: -p.dir } : { key, dir: 1 }));
  const sortedRows = useMemo(() => {
    if (!sort.key) return rows;
    const val = (r) => (sort.key === 'driver' ? servedBy.get(r.ref) : sort.key === 'fvPer' ? r.fvPer : r[sort.key]);
    return [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x == null || x === '') return y == null || y === '' ? 0 : 1;   // blanks last
      if (y == null || y === '') return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y
        : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.dir;
    });
  }, [rows, sort, servedBy]);
  const Th = ({ k, className = '', children, ...rest }) => (
    <th className={`${className} sortable`} onClick={() => sortBy(k)} {...rest}>
      {children}{sort.key === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
    </th>
  );

  const copyPatch = async () => {
    setError(null);
    try {
      await api.copyPatch(await api.generateEstimatePatch(opts, zone));
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
      <div className="dp-head">
        <h5 className="mb-0">Driver estimate</h5>
        {zone && <ViewToggle model={model} zone={zone} current="estimate" dispatch={dispatch} />}
        {/* An early design has hubs and Elements but no cables: the space layout is
            still where they are arranged, so the quiet way in is here too. */}
        {zone && (
          <button type="button" className="space-link" title="Hub layout" aria-label="Open the hub layout"
            onClick={() => dispatch({ type: 'SET_VIEW', view: { page: 'layout', zone, from: 'estimate' } })}>
            <span className="material-icons">straighten</span>
          </button>
        )}
        <span className="text-secondary small">
          {rows.length} row{rows.length === 1 ? '' : 's'} · {posTypes.size} PositionType{posTypes.size === 1 ? '' : 's'}
          {' · '}{zone ?? `${zones.length} hub${zones.length === 1 ? '' : 's'}`}
          {views?.cables ? '' : ' · no links yet'}
        </span>
        {totals.unmatched > 0 && (
          <span className="dp-need" title="No ElementType in the DesignDB can take these, so no driver is counted for them">
            {unmatchedLabel()} unmatched
          </span>
        )}
      </div>

      {/* Always shown, never dismissable: the count is a starting point. */}
      <div className="alert alert-warning d-flex align-items-start gap-2 py-2 small" role="note">
        <span className="material-icons small-icon">warning</span>
        <div><strong>Check every calculation.</strong> {ESTIMATE_WARNING}</div>
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

      {/* Each of these makes the estimate looser, and the count higher. Turning
          them all off gives the tightest possible answer, which is rarely the
          one to price at tender. */}
      <div className="est-constraints">
        <span className="est-c-label">Keep separate</span>
        {[
          ['restrictControlGroup', 'nodeControlGroup', 'ControlGroups', 'ControlGroup'],
          ['splitByType', 'nodeSplitByType', 'Fitting types', 'fitting type'],
          ['splitByLocation', 'nodeSplitByLocation', 'Rooms', 'room'],
        ].map(([dk, nk, label, what]) => (
          <span key={dk} className="est-c est-c-pair">
            {label}
            <label className="est-c" title={`Never put two ${what}s on one driver`}>
              <input type="checkbox" checked={!!prefs[dk]} onChange={(e) => setPref({ [dk]: e.target.checked })} />
              driver
            </label>
            <label className="est-c"
              title={prefs[dk] ? `Implied: a driver already carries one ${what}`
                : `Never put two ${what}s on one output. A driver may still carry several, one per output`}>
              <input type="checkbox" checked={!!prefs[dk] || !!prefs[nk]} disabled={!!prefs[dk]}
                onChange={(e) => setPref({ [nk]: e.target.checked })} />
              output
            </label>
          </span>
        ))}
        <span className="est-c-label ms-3">Choosing a part</span>
        <label className="est-c" title="Reach for a single-output driver rather than consolidating a pair onto one 2-output driver. Consolidating is a decision for the detail design, not the estimate">
          <input type="checkbox" checked={!!prefs.preferSingleOutput}
            onChange={(e) => setPref({ preferSingleOutput: e.target.checked })} />
          Prefer single output
        </label>
        <label className="est-c ms-3" title="Local (switched, unaddressed) drivers are left out of sizing and flagged in a hub unless this is on">
          <input type="checkbox" checked={!!prefs.allowLocal}
            onChange={(e) => setPref({ allowLocal: e.target.checked })} />
          Allow Local drivers
        </label>
        <span className="est-c-label ms-3">Spare capacity</span>
        <label className="est-c" title="Capacity left free on every driver">
          <input type="number" className="form-control form-control-sm margin-input"
            min="0" max="50" step="1" value={marginPct}
            onChange={(e) => setPref({ margin: Math.min(50, Math.max(0, Number(e.target.value) || 0)) / 100 })} />
          % margin
        </label>
      </div>

      <div className="est-total">
        <b>{totals.drivers} drivers</b>
        <span className="text-secondary">
          {totals.byType.map(([t, n]) => `${n} × ${t}`).join(' · ')}
        </span>
        <button className="btn btn-sm btn-outline-secondary ms-auto" onClick={exportCsv}>Export CSV</button>
        <button className="btn btn-sm btn-primary" onClick={copyPatch}
          title="An ExcelScript that appends these drivers to the Elements sheet">
          {copied ? 'Copied!' : 'Copy Elements patch'}
        </button>
      </div>

      {error && <div className="alert alert-danger py-2 mt-2">{error}</div>}

      {/* the patch appends rows it cannot name; naming them is the next job */}
      {totals.drivers > 0 && (
        <div className="rv-todo mt-2">
          <span className="material-icons">edit_note</span>
          <div>
            <b>Give each appended row a Ref before committing.</b> One row per type
            per hub, with the count in Quantity.
          </div>
        </div>
      )}

      <div className="dp-list mt-3">
        {zones.map((z) => (
          <div key={z.zone} className="dp-part">
            <div className="dp-part-head" style={{ cursor: 'default' }}>
              <span className="dp-name">{z.zone}</span>
              <span className="dp-spec">{fmt(z.loadW)}W</span>
              <span className="dp-count">{z.drivers} driver{z.drivers === 1 ? '' : 's'}</span>
            </div>
            {z.lines.map((l) => (
              <div key={l.key} className="dp-ref">
                <span className="dp-ref-id">{l.count} × {l.typeRef}</span>
                <span className="dp-ref-spec">
                  {l.positionTypes?.join(', ') || '-'} · {amount(l.qty, l.rows)} · {l.perDriver} per driver
                  {l.perNode != null && ` · ${l.perNode} per output`}
                </span>
                <span className="dp-ref-use" title={`Limited by ${WHY[l.limit] ?? l.limit}`}>
                  {l.limit} limited
                </span>
                <span className="dp-ref-use">{l.controlGroup || '-'}</span>
              </div>
            ))}
            {z.unmatched.map((u) => (
              <div key={u.key} className="dp-ref is-off">
                <span className="dp-ref-id">{amount(u.qty, u.rows)}</span>
                <span className="dp-fault">
                  {u.reason ?? 'No ElementType in the DesignDB can take these'} - {u.key}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* what the fittings actually are, since nothing else on this page says */}
      <details className="est-rows mt-3">
        <summary>The {rows.length} assessment rows behind this</summary>
        <div className="scrollx">
          <table className="table table-sm align-middle mt-2">
            <thead>
              <tr>
                <Th k="zone">Hub</Th><Th k="location">Location</Th><Th k="positionType">PositionType</Th>
                <Th k="controlGroup">ControlGroup</Th>
                <Th k="qty" className="text-end" title="SumQuantity - a count of fittings, or metres where the PositionType's UoM is m">
                  Quantity
                </Th>
                <Th k="wPer" className="text-end" title="PowerPerUoM - watts per metre for tape, per piece for a fitting">PowerPerUoM</Th>
                <Th k="fvPer" className="text-end" title="Forward voltage per UoM, from CC_Vf ÷ SumQuantity">fV per UoM</Th>
                <Th k="powerType">CC/CV</Th>
                <Th k="currentA" className="text-end" title="CurrentPerUoM - the current this fitting is driven at">CC_Current</Th>
                <Th k="driver" title="The driver this row was sized onto">Driver</Th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => {
                const part = resolveSpec(r.positionType);
                return (
                  <tr key={r.ref} data-code={r.ref}>
                    <td>{r.zone}</td>
                    <td>{r.location}</td>
                    <td>{r.positionType}{part && ` · ${part.name}`}</td>
                    <td>{r.controlGroup}</td>
                    <td className="text-end">{r.uom ? `${fmt(r.qty)} ${r.uom}` : fmt(r.qty)}</td>
                    <td className="text-end">{fmt(r.wPer)}</td>
                    <td className="text-end">{fmt(r.fvPer) ?? '-'}</td>
                    <td>{r.powerType ?? '-'}</td>
                    <td className="text-end">{r.currentA != null ? `${r.currentA}A` : '-'}</td>
                    <td>{servedBy.get(r.ref) ?? <span className="dp-fault">no driver</span>}</td>
                    <td className="text-end">
                      <KebabMenu title="Row actions" items={[{
                        label: 'Report an issue', icon: 'flag',
                        onClick: (e) => openReport(e.currentTarget.closest('tr')),
                      }]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
