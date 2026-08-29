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

export default function EstimatePage({ state, dispatch }) {
  const { model, prefs } = state;
  const [zones, setZones] = useState([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  const opts = { restrictControlGroup: prefs.restrictControlGroup, margin: prefs.margin };
  useEffect(() => {
    let stale = false;
    api.estimate(opts).then((z) => !stale && setZones(z)).catch((e) => setError(e.message));
    return () => { stale = true; };
  }, [model, prefs.restrictControlGroup, prefs.margin]);

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

  const fittings = model.requirements.reduce((n, r) => n + r.qty, 0);

  const copyPatch = async () => {
    setError(null);
    try {
      await api.copyPatch(await api.generateEstimatePatch(opts));
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
          {fittings} fittings · {model.zones.length} hub{model.zones.length === 1 ? '' : 's'} · no links yet
        </span>
        {totals.unmatched > 0 && (
          <span className="dp-need" title="No type in the library can take these, so they are not counted">
            {totals.unmatched} fittings unmatched
          </span>
        )}
        <div className="ms-auto d-flex align-items-center gap-3">
          <div className="form-check form-switch mb-0" title="Never put two ControlGroups on one driver">
            <input className="form-check-input" type="checkbox" id="estCg"
              checked={!!prefs.restrictControlGroup}
              onChange={(e) => setPref({ restrictControlGroup: e.target.checked })} />
            <label className="form-check-label small" htmlFor="estCg">One ControlGroup per driver</label>
          </div>
          <label className="small d-flex align-items-center gap-1 mb-0" title="Capacity left free on every driver">
            Margin
            <input type="number" className="form-control form-control-sm margin-input"
              min="0" max="50" step="1" value={marginPct}
              onChange={(e) => setPref({ margin: Math.min(50, Math.max(0, Number(e.target.value) || 0)) / 100 })} />
            %
          </label>
        </div>
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
                  {l.qty} fittings · {l.perDriver} per driver
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
                <span className="dp-ref-id">{u.qty} fittings</span>
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
        <summary>The {model.requirements.length} assessment rows behind this</summary>
        <div className="scrollx">
          <table className="table table-sm align-middle mt-2">
            <thead>
              <tr>
                <th>Hub</th><th>Location</th><th>PositionType</th><th>ControlGroup</th>
                <th className="text-end">Qty</th><th className="text-end">W each</th>
                <th className="text-end">fV each</th><th>Type</th>
              </tr>
            </thead>
            <tbody>
              {model.requirements.map((r) => {
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
