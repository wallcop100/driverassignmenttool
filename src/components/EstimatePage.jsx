import { useEffect, useMemo, useState } from 'react';
import * as api from '../api.js';
import { resolveSpec } from '../engine.js';

// Tender estimate — Positions rolled up by DJ 100053, no links and no drivers.
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
    preferSingleOutput: prefs.preferSingleOutput,
    margin: prefs.margin,
  };
  useEffect(() => {
    let stale = false;
    api.estimate(opts, zone).then((z) => !stale && setZones(z)).catch((e) => setError(e.message));
    return () => { stale = true; };
  }, [model, zone, prefs.restrictControlGroup, prefs.splitByType, prefs.splitByLocation,
      prefs.preferSingleOutput, prefs.margin]);

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
    const csv = rows.map((r) => r.map((v) => `"${String(v ?? '')}"`).join(',')).join('\r\n');
    const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    await api.saveCsv(`${csv}\r\n`, `DriverEstimate-${stamp}.csv`);
  };

  return (
    <div className="container-fluid py-3 drivers-page">
      <div className="dp-head">
        <h5 className="mb-0">Driver estimate</h5>
        <span className="text-secondary small">
          {rows.length} row{rows.length === 1 ? '' : 's'} · {posTypes.size} PositionType{posTypes.size === 1 ? '' : 's'}
          {' · '}{zone ?? `${zones.length} hub${zones.length === 1 ? '' : 's'}`} · no links yet
        </span>
        {totals.unmatched > 0 && (
          <span className="dp-need" title="No type in the library can take these, so no driver is counted for them">
            {fmt(totals.unmatched)} UoM unmatched
          </span>
        )}
      </div>

      {/* Each of these makes the estimate looser, and the count higher. Turning
          them all off gives the tightest possible answer, which is rarely the
          one to price at tender. */}
      <div className="est-constraints">
        <span className="est-c-label">Keep separate</span>
        {[
          ['restrictControlGroup', 'ControlGroups', 'Never put two ControlGroups on one driver'],
          ['splitByType', 'Fitting types', 'Never put two fitting types on one driver'],
          ['splitByLocation', 'Rooms', 'Never let a driver serve more than one room'],
        ].map(([k, label, tip]) => (
          <label key={k} className="est-c" title={tip}>
            <input type="checkbox" checked={!!prefs[k]} onChange={(e) => setPref({ [k]: e.target.checked })} />
            {label}
          </label>
        ))}
        <span className="est-c-label ms-3">Choosing a part</span>
        <label className="est-c" title="Reach for a single-output driver rather than consolidating a pair onto one 2-output driver. Consolidating is a decision for the detail design, not the estimate">
          <input type="checkbox" checked={!!prefs.preferSingleOutput}
            onChange={(e) => setPref({ preferSingleOutput: e.target.checked })} />
          Prefer single output
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
                  {l.positionTypes?.join(', ') || '—'} · {fmt(l.qty)} UoM · {l.perDriver} per driver
                  {l.perNode != null && ` · ${l.perNode} per output`}
                </span>
                <span className="dp-ref-use" title={`Limited by ${WHY[l.limit] ?? l.limit}`}>
                  {l.limit} limited
                </span>
                <span className="dp-ref-use">{l.controlGroup || '—'}</span>
              </div>
            ))}
            {z.unmatched.map((u) => (
              <div key={u.key} className="dp-ref is-off">
                <span className="dp-ref-id">{fmt(u.qty)} UoM</span>
                <span className="dp-fault">
                  {u.reason ?? 'no type in the library can take these'} — {u.key}
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
                <th>Hub</th><th>Location</th><th>PositionType</th><th>ControlGroup</th>
                <th className="text-end" title="SumQuantity — in the PositionType's UoM: metres for tape, pieces for fittings. DJ 100053 strips the unit off P.Dim, so the number does not say which">
                  Quantity
                </th>
                <th className="text-end" title="PowerPerUoM — watts per metre for tape, per piece for a fitting">PowerPerUoM</th>
                <th className="text-end" title="Forward voltage per UoM, from CC_Vf ÷ SumQuantity">fV per UoM</th>
                <th>CC/CV</th>
                <th className="text-end" title="CurrentPerUoM — the current this fitting is driven at">CC_Current</th>
                <th title="The driver this row was sized onto">Driver</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const part = resolveSpec(r.positionType);
                return (
                  <tr key={r.ref}>
                    <td>{r.zone}</td>
                    <td>{r.location}</td>
                    <td>{r.positionType}{part && ` · ${part.name}`}</td>
                    <td>{r.controlGroup}</td>
                    <td className="text-end">{r.qty}</td>
                    <td className="text-end">{fmt(r.wPer)}</td>
                    <td className="text-end">{fmt(r.fvPer) ?? '—'}</td>
                    <td>{r.powerType ?? '—'}</td>
                    <td className="text-end">{r.currentA != null ? `${r.currentA}A` : '—'}</td>
                    <td>{servedBy.get(r.ref) ?? <span className="dp-fault">no driver</span>}</td>
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
