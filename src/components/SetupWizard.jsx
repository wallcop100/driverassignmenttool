import { useMemo, useState } from 'react';
import { PARTS, combine, resolveSpec, statedAttributes } from '../engine.js';
import PresetEditor, { draftFrom, draftFromPart, toPreset } from './PresetEditor.jsx';
import { autoFillable, fillFromSpec, fmt } from '../typeFaults.js';

// Onboarding a project to Lighting DesignDB V4.6. Every driver ElementType on
// the job states none of the ten attributes the checks run on, so nothing here
// works: every driver is undetermined, nothing can be sized, every check is
// skipped. It is the same handful of rows for the whole project, so it is one
// job to do once rather than a fault to flag on each type.
//
// The datasheet does most of it. Each type is matched by name, the values come
// off the spec page, and what is left is what a datasheet cannot know: which
// current a CC driver is set to, and which supply a DC/DC driver runs on.

const stepFor = (t) => {
  const spec = resolveSpec(t.name || t.typeRef);
  return { t, spec, part: spec?.driver ?? spec ?? null };
};

export default function SetupWizard({ model, presets, dispatch, onClose, only }) {
  // Only the types this walk is about. From the types page that is the ones in
  // use — a library of forty parts nobody has placed is not what you came to
  // fill in — and the caller says so rather than the wizard guessing.
  const inventory = useMemo(
    () => (only ? model.inventory.filter((t) => only.has(t.typeRef)) : model.inventory),
    [model.inventory, only],
  );
  const steps = useMemo(() => inventory.map(stepFor), [inventory]);
  const auto = useMemo(() => autoFillable(inventory, resolveSpec), [inventory]);
  const pending = auto.ready.filter((r) => !presets[r.t.typeRef]);
  const [i, setI] = useState(0);
  const [draft, setDraft] = useState(null);
  const [choice, setChoice] = useState({});   // per typeRef: { part, psu, currentA }

  const step = steps[i];
  const done = steps.filter(({ t }) => presets[t.typeRef]).length;
  if (!step) return null;

  const key = step.t.typeRef;
  const picked = choice[key] ?? {};
  // the matched part unless the user has said otherwise
  const part = PARTS.find((p) => p.name === picked.part) ?? step.part;
  const psu = PARTS.find((p) => p.name === picked.psu) ?? null;
  const spec = part ? combine(part, part.kind === 'dcdc' ? psu : null) : null;
  const needsPsu = part?.kind === 'dcdc';
  const needsCurrent = spec?.powerType === 'CC' && !(spec.minA != null && spec.minA === spec.maxA);
  const ready = !!spec && (!needsPsu || psu) && (!needsCurrent || Number(picked.currentA) > 0);

  const set = (patch) => setChoice({ ...choice, [key]: { ...picked, ...patch } });

  // What the tool would write for this type: the datasheet's values, the node
  // list the part defines, and the Ref kept exactly as the DesignDB has it.
  const proposed = () => {
    const d = draftFromPart(part, needsPsu ? psu : null);
    return toPreset({
      ...d,
      typeRef: step.t.typeRef,
      name: step.t.name || d.name,
      currentA: needsCurrent ? Number(picked.currentA) / 1000 : (spec.minA ?? ''),
      invented: false,
    });
  };

  const accept = () => {
    dispatch({ type: 'SET_PRESET', preset: proposed() });
    setDraft(null);
    if (i < steps.length - 1) setI(i + 1);
  };

  return (
    <div className="nt-backdrop">
      <div className="nt-dialog sw-dialog" role="dialog" aria-label="Set up driver attributes">
        <div className="nt-head">
          <b>Driver attributes</b>
          <span className="text-secondary small">
            {done} of {steps.length} filled in
          </span>
          <button className="btn btn-sm btn-link ms-auto p-0" onClick={onClose}>close</button>
        </div>

        {pending.length > 0 && (
          <div className="sw-all">
            <div>
              <b>{pending.length} of these need no questions</b>
              <div className="text-secondary small">
                Their datasheet is matched, the current is in the Ref and the supply
                is in the Name. {auto.asks.length > 0
                  ? `The other ${auto.asks.length} are asked about below.`
                  : 'That is all of them.'}
              </div>
            </div>
            <button className="btn btn-sm btn-primary ms-auto"
              onClick={() => {
                for (const r of pending) {
                  dispatch({ type: 'SET_PRESET', preset: fillFromSpec(r) });
                }
                const next = steps.findIndex((s) => auto.asks.some((a) => a.t.typeRef === s.t.typeRef));
                if (next >= 0) setI(next);
              }}>
              Fill in all {pending.length}
            </button>
          </div>
        )}

        <div className="sw-rail">
          {steps.map((s, n) => (
            <button key={s.t.typeRef} type="button"
              className={`sw-pip ${n === i ? 'is-on' : ''} ${presets[s.t.typeRef] ? 'is-done' : ''}`}
              title={s.t.typeRef} onClick={() => { setI(n); setDraft(null); }} />
          ))}
        </div>

        <div className="sw-body">
          <div className="sw-head">
            <span className="tp-ref">{step.t.typeRef}</span>
            <span className="tp-name">{step.t.name || '—'}</span>
            {presets[key] && <span className="tp-dot">filled in</span>}
          </div>

          {!draft && (
            <>
              <label className="fld sw-part">
                <span className="fld-col">Which driver is this?</span>
                <select className="form-select form-select-sm" value={part?.name ?? ''}
                  onChange={(e) => set({ part: e.target.value, psu: '', currentA: '' })}>
                  <option value="">Not one of these…</option>
                  {PARTS.filter((p) => p.kind !== 'supply').map((p) => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
                {step.part && !picked.part && (
                  <span className="fld-ds">matched on the name</span>
                )}
              </label>

              {needsPsu && (
                <label className="fld sw-part">
                  <span className="fld-col">On which supply?</span>
                  <select className="form-select form-select-sm" value={picked.psu ?? ''}
                    onChange={(e) => set({ psu: e.target.value })}>
                    <option value="">Choose…</option>
                    {PARTS.filter((p) => p.kind === 'supply').map((p) => (
                      <option key={p.name} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                  <span className="fld-ds">it sets the voltage and caps the watts</span>
                </label>
              )}

              {needsCurrent && (
                <label className="fld sw-part">
                  <span className="fld-col">Driven at what current?</span>
                  <span className="fld-box">
                    <input type="number" min="0" step="10" style={{ width: 90 }}
                      placeholder={spec.minA != null ? `${spec.minA * 1000}–${spec.maxA * 1000}` : 'mA'}
                      value={picked.currentA ?? ''} onChange={(e) => set({ currentA: e.target.value })} />
                    mA
                  </span>
                  <span className="fld-ds">the Ref usually says: {step.t.typeRef}</span>
                </label>
              )}

              {ready ? (
                <div className="sw-preview">
                  <div className="fld-sec">This writes</div>
                  <table className="table table-sm mb-0">
                    <tbody>
                      {[
                        ['Parameters', `{${(proposed().nodeNames
                          ?? Array.from({ length: proposed().outputs }, (_, n) => `OP.${n + 1}`))
                          .map((n) => `<${n}`).join(',')}}`],
                        ['BallastCountPerUoM', proposed().addresses],
                        ['MaxPower(W)', proposed().maxPowerW],
                        ['CurrentRange', proposed().currentA],
                        ['OutputVoltage(V)', proposed().outputVoltageV],
                        ['NodeMaxPower(W)', proposed().nodeMaxLoadW],
                        ['NodeCurrent', proposed().nodeCurrentA],
                        ['NodeMaxForwardVoltage(fV)', proposed().nodeMaxFvV],
                        ['ControlType', proposed().controlType],
                      ].map(([col, v]) => (
                        <tr key={col} className={v == null || v === '' ? 'sw-blank' : undefined}>
                          <td className="sw-col">{col}</td>
                          <td className="sw-val">{v == null || v === '' ? '—' : fmt(v) ?? v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-secondary small mt-2 mb-0">
                    Blank means no check. Numbers only, and amps rather than milliamps.
                  </p>
                </div>
              ) : (
                <p className="text-secondary small mt-3">
                  {part
                    ? 'Answer the question above and the datasheet fills in the rest.'
                    : 'No datasheet match. Pick the part, or fill the columns in by hand.'}
                </p>
              )}
            </>
          )}

          {draft && (
            <PresetEditor draft={draft} setDraft={setDraft} inventory={model.inventory}
              onSave={() => {
                dispatch({ type: 'SET_PRESET', preset: toPreset(draft) });
                setDraft(null);
                if (i < steps.length - 1) setI(i + 1);
              }}
              onCancel={() => setDraft(null)} />
          )}
        </div>

        {!draft && (
          <div className="nt-foot">
            <button className="btn btn-sm btn-link nt-all"
              onClick={() => setDraft(ready ? draftFrom({ ...step.t, ...proposed() }) : draftFrom(step.t))}>
              Fill it in by hand
            </button>
            <button className="btn btn-sm btn-outline-secondary" disabled={i === 0}
              onClick={() => { setI(i - 1); setDraft(null); }}>Back</button>
            <button className="btn btn-sm btn-outline-secondary" disabled={i >= steps.length - 1}
              onClick={() => { setI(i + 1); setDraft(null); }}>Skip</button>
            <button className="btn btn-sm btn-primary" disabled={!ready} onClick={accept}>
              {i < steps.length - 1 ? 'Use this, next' : 'Use this'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
