import { useMemo, useState } from 'react';
import { PARTS, combine } from '../engine.js';
import PresetEditor, { draftFromPart, toPreset } from './PresetEditor.jsx';
import { fmt } from '../typeFaults.js';

// Defining an ElementType the design does not have yet. Not a set of pages to
// walk: you already know what you want — CC, 500mA or more, two outputs — so the
// filters are the question and the shortlist is the answer.
//
// Nothing here invents a rating. Every value comes from the datasheet part or
// from the two things the datasheet cannot know: the current picked out of its
// range, and the supply a DC/DC driver runs on.

const anyOf = (v, ...vals) => vals.some((x) => x === v);

export default function NewTypeDialog({ zone, inventory, dispatch, onClose, onCreated }) {
  const [powerType, setPowerType] = useState('any');
  const [minA, setMinA] = useState('');       // mA, as people say it
  const [minW, setMinW] = useState('');
  const [outputs, setOutputs] = useState('any');
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState(null); // part name
  const [psu, setPsu] = useState('');
  const [currentA, setCurrentA] = useState('');
  const [advanced, setAdvanced] = useState(null); // a draft, once the editor is opened

  const matches = useMemo(() => {
    const a = minA === '' ? null : Number(minA) / 1000;
    const w = minW === '' ? null : Number(minW);
    const needle = q.trim().toLowerCase();
    return PARTS.filter((p) => {
      if (p.kind === 'supply') return false;             // a PSU is half a type, never a type
      if (p.discontinued) return false;                  // you cannot buy it
      if (powerType !== 'any' && p.powerType !== powerType) return false;
      // A CC part covers a range; asking for 500mA keeps every part that reaches it.
      if (a != null && !(p.powerType === 'CC' && p.maxA != null && p.maxA >= a)) return false;
      // A DC/DC driver states no wattage of its own — the supply sets it, so a
      // power filter cannot rule it out.
      if (w != null && p.maxPowerW != null && p.maxPowerW < w) return false;
      if (outputs !== 'any' && (p.outputs ?? 1) !== Number(outputs)) return false;
      if (needle && !p.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [powerType, minA, minW, outputs, q]);

  const part = PARTS.find((p) => p.name === chosen) ?? null;
  const supply = PARTS.find((p) => p.name === psu) ?? null;
  const spec = part ? combine(part, part.kind === 'dcdc' ? supply : null) : null;

  // The two things the datasheet cannot settle for us.
  const needsPsu = part?.kind === 'dcdc';
  const needsCurrent = spec?.powerType === 'CC' && !(spec.minA != null && spec.minA === spec.maxA);
  const ready = !!part && (!needsPsu || supply) && (!needsCurrent || Number(currentA) > 0);

  const draft = useMemo(() => {
    if (!part) return null;
    const d = draftFromPart(part, needsPsu ? supply : null);
    const a = needsCurrent ? Number(currentA) / 1000 : (spec?.minA ?? '');
    return { ...d, currentA: a === '' || Number.isNaN(a) ? '' : a };
  }, [part, supply, currentA, needsPsu, needsCurrent]);

  const create = (alsoAdd) => {
    const preset = toPreset(advanced ?? draft);
    if (!preset.typeRef) return;
    dispatch({ type: 'SET_PRESET', preset });
    if (alsoAdd && zone) dispatch({ type: 'ADD_DRIVER', typeRef: preset.typeRef, zone });
    onCreated?.(preset.typeRef, alsoAdd);
    onClose();
  };

  const proposedRef = draft ? toPreset(draft).typeRef : '';

  return (
    <div className="nt-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="nt-dialog" role="dialog" aria-label="New driver type">
        <div className="nt-head">
          <b>New driver type</b>
          <span className="text-secondary small">{matches.length} of {PARTS.length} parts</span>
          <button className="btn btn-sm btn-link ms-auto p-0" onClick={onClose}>close</button>
        </div>

        <div className="nt-filters">
          <div className="nt-filter">
            <span>Type</span>
            <div className="nt-seg">
              {['CC', 'CV', 'any'].map((v) => (
                <button key={v} className={powerType === v ? 'is-on' : ''}
                  onClick={() => setPowerType(v)}>{v}</button>
              ))}
            </div>
          </div>
          {anyOf(powerType, 'CC', 'any') && (
            <label className="nt-filter" title="Parts whose range reaches at least this current">
              <span>Current ≥</span>
              <input type="number" min="0" step="10" placeholder="mA" value={minA}
                onChange={(e) => setMinA(e.target.value)} />
              <em>mA</em>
            </label>
          )}
          <label className="nt-filter" title="Parts rated at least this many watts">
            <span>Power ≥</span>
            <input type="number" min="0" step="5" placeholder="W" value={minW}
              onChange={(e) => setMinW(e.target.value)} />
            <em>W</em>
          </label>
          <div className="nt-filter">
            <span>Outputs</span>
            <div className="nt-seg">
              {['1', '2', 'any'].map((v) => (
                <button key={v} className={outputs === v ? 'is-on' : ''}
                  onClick={() => setOutputs(v)}>{v}</button>
              ))}
            </div>
          </div>
          <input className="form-control form-control-sm nt-q" placeholder="Filter by name…"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <div className="nt-list">
          {matches.map((p) => (
            <button key={p.name} className={`nt-part ${chosen === p.name ? 'is-on' : ''}`}
              onClick={() => { setChosen(p.name); setAdvanced(null); }}>
              <span className={`type-power is-${p.powerType.toLowerCase()}`}>{p.powerType}</span>
              <span className="nt-part-name">{p.name}</span>
              <span className="nt-part-spec">
                {p.maxPowerW != null ? `${fmt(p.maxPowerW)}W` : 'W set by the supply'}
                {p.powerType === 'CC' && p.minA != null
                  && ` · ${p.minA === p.maxA ? `${p.minA}A` : `${p.minA}–${p.maxA}A`}`}
                {p.outputV != null && ` · ${p.outputV}V`}
                {p.maxFvV != null && ` · ${p.maxFvV}fV/out`}
              </span>
              <span className="nt-part-ch">{p.outputs ?? 1} out</span>
            </button>
          ))}
          {!matches.length && (
            <div className="nt-empty">No datasheet part matches those filters.</div>
          )}
        </div>

        {part && !advanced && (
          <div className="nt-pick">
            {needsPsu && (
              <label className="nt-filter" title="A DC/DC driver has no rail of its own — the supply sets the voltage and caps the wattage">
                <span>Supply</span>
                <select className="form-select form-select-sm" value={psu}
                  onChange={(e) => setPsu(e.target.value)}>
                  <option value="">Choose…</option>
                  {PARTS.filter((p) => p.kind === 'supply').map((p) => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </label>
            )}
            {needsCurrent && (
              <label className="nt-filter"
                title={spec.minA != null ? `Anywhere in ${spec.minA}–${spec.maxA}A` : 'Amps, as the datasheet gives them'}>
                <span>CurrentRange</span>
                <input type="number" min="0" step="10"
                  placeholder={spec.minA != null ? `${spec.minA * 1000}–${spec.maxA * 1000}` : 'mA'}
                  value={currentA} onChange={(e) => setCurrentA(e.target.value)} />
                <em>mA</em>
              </label>
            )}
            <span className="nt-ref" title="Generated from the values — edit it in the fields if it needs to differ">
              {ready ? proposedRef || '—' : 'choose the values above'}
            </span>
          </div>
        )}

        {/* everything the two questions above do not cover */}
        {advanced && (
          <PresetEditor draft={advanced} setDraft={setAdvanced} inventory={inventory}
            onSave={() => create(false)} onCancel={() => setAdvanced(null)} />
        )}

        {!advanced && (
          <div className="nt-foot">
            <button className="btn btn-sm btn-link p-0 me-auto" disabled={!ready}
              onClick={() => setAdvanced(draft)}>
              edit all fields
            </button>
            <button className="btn btn-sm btn-outline-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-sm btn-outline-primary" disabled={!ready}
              onClick={() => create(false)}>Create</button>
            {zone && (
              <button className="btn btn-sm btn-primary" disabled={!ready}
                onClick={() => create(true)}>Create and add to {zone}</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
