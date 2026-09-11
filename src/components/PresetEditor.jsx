import { useEffect, useState } from 'react';
import { combine, nextTypeRef, PARTS, reachableW, resolveSpec } from '../engine.js';

// The driver type editor, shared by the Add-driver modal and the Driver types
// page. A preset is a rating nobody declared, supplied here and patched into the
// workbook's ElementTypes row — so the fields are that sheet's columns, named as
// they are named there. Explanations live in tooltips, not on the page.
export function rating(t) {
  if (t.powerType === 'CC' && t.currentA != null) return `${t.currentA}A`;
  if (t.powerType === 'CV' && t.outputVoltageV != null) return `${t.outputVoltageV}V`;
  return null;
}

const numOrNull = (v) => (v === '' || v == null ? null : Number(v));
const g = (n) => (Number.isInteger(n) ? n : +n.toFixed(2));

// A type in the catalogue, as the editor holds it.
export const draftFrom = (t) => ({
  typeRef: t.typeRef,
  name: t.name ?? '',
  powerType: t.powerType ?? 'CC',
  maxPowerW: t.maxPowerW ?? '',
  currentA: t.currentA ?? '',
  outputVoltageV: t.outputVoltageV ?? '',
  outputs: t.outputs ?? t.nodes?.length ?? 1,
  addresses: t.addresses ?? t.ballast ?? '',
  nodeNames: t.nodes?.map((n) => n.name) ?? null,
  nodeMaxLoadW: t.nodeMaxLoadW ?? t.nodes?.[0]?.maxLoadW ?? '',
  nodeMaxFvV: t.nodeMaxFvV ?? t.nodes?.[0]?.maxFvV ?? '',
  nodeCurrentA: t.nodeCurrentA ?? '',
  controlType: t.controlType ?? '',
  invented: false,
});

// A datasheet part — or a DC/DC driver on a named supply, which is how CV is
// normally specified here — as a draft. Blank stays blank: on the spec pages a
// blank means "no check", and filling one in would invent a rule.
export const draftFromPart = (driver, supply = null) => {
  const p = combine(driver, supply) ?? {};
  return {
    typeRef: '', invented: true,
    part: driver?.name ?? '', psu: supply?.name ?? '',
    name: p.name ?? '',
    powerType: p.powerType ?? 'CV',
    maxPowerW: p.maxPowerW ?? '',
    currentA: '',                     // one ElementType per current — the user picks
    outputVoltageV: p.outputV ?? '',
    outputs: p.outputs ?? 1,
    addresses: p.addresses ?? '',
    // a part may name its nodes: {<OP.1-2} is ONE node carrying two channels,
    // which is how a DT8 tuneable white driver is written. Never a colon.
    nodeNames: p.nodeNames ?? null,
    nodeMaxLoadW: p.nodeMaxLoadW ?? '',
    nodeMaxFvV: p.maxFvV ?? '',
    nodeCurrentA: p.nodeCurrentA ?? '',
    controlType: p.controlType ?? '',
    stem: p.stem ?? null,
  };
};

export const toPreset = (d) => ({
  typeRef: d.typeRef.trim(),
  name: (d.name ?? '').trim(),
  powerType: d.powerType,
  maxPowerW: numOrNull(d.maxPowerW),
  currentA: d.powerType === 'CC' ? numOrNull(d.currentA) : null,
  outputVoltageV: d.powerType === 'CV' ? numOrNull(d.outputVoltageV) : null,
  outputs: Math.max(1, Number(d.outputs) || 1),
  addresses: numOrNull(d.addresses),
  nodeNames: d.nodeNames ?? null,
  nodeCurrentA: numOrNull(d.nodeCurrentA),
  controlType: (d.controlType ?? '').trim() || null,
  nodeMaxLoadW: numOrNull(d.nodeMaxLoadW),
  nodeMaxFvV: numOrNull(d.nodeMaxFvV),
  invented: !!d.invented,
});

// Enough to size against — below this the planner refuses the type anyway.
const isComplete = (d) => !!d.typeRef.trim() && numOrNull(d.maxPowerW) > 0
  && (d.powerType === 'CC' ? numOrNull(d.currentA) > 0 : numOrNull(d.outputVoltageV) > 0);

export default function PresetEditor({ draft, setDraft, inventory, onSave, onCancel, onDelete }) {
  const set = (patch) => setDraft({ ...draft, ...patch });
  const [ownRef, setOwnRef] = useState(false);

  // The datasheet for whatever the type's Name says it is — a driver, a supply,
  // or the pair. Names are free text, so this is a loose match and can be wrong:
  // it advises, never edits.
  const chosen = PARTS.find((p) => p.name === draft.part);
  const chosenPsu = PARTS.find((p) => p.name === draft.psu);
  const part = draft.invented && chosen
    ? combine(chosen, chosenPsu)
    : resolveSpec(draft.name || draft.typeRef);

  useEffect(() => {
    if (!draft.invented || ownRef) return;
    const next = nextTypeRef(inventory, {
      powerType: draft.powerType,
      currentA: numOrNull(draft.currentA),
      outputVoltageV: numOrNull(draft.outputVoltageV),
      addresses: numOrNull(draft.addresses) ?? (Number(draft.outputs) || 1),
      stem: draft.stem,
    });
    if (next && next !== draft.typeRef) set({ typeRef: next });
  }, [draft.powerType, draft.currentA, draft.outputVoltageV, draft.addresses, draft.outputs, ownRef]);

  // What the datasheet says for a field, and whether the entry disagrees.
  const spec = {
    maxPowerW: part?.maxPowerW,
    outputVoltageV: part?.outputV,
    outputs: part?.outputs,
    addresses: part?.addresses,
    nodeMaxFvV: part?.maxFvV,
    nodeMaxLoadW: part?.nodeMaxLoadW,
    nodeCurrentA: part?.nodeCurrentA,
    controlType: part?.controlType,
  };

  // One field: the schema's own column name above a box that looks like a box,
  // and — where the datasheet says otherwise — an offer you can take rather than
  // a red note that only nags.
  const Field = ({ col, k, tip, step, children }) => {
    const want = spec[k];
    const has = numOrNull(draft[k]);
    const off = want != null && has != null && Math.abs(has - want) > 1e-9;
    const blank = want != null && draft[k] === '';
    return (
      <label className={`fld ${off ? 'is-off' : ''}`}>
        <span className="fld-col" title={tip}>{col}</span>
        {children ?? (
          <input type="number" min="0" step={step ?? 'any'} value={draft[k]}
            placeholder="—" onChange={(e) => set({ [k]: e.target.value })} />
        )}
        {(off || blank) && (
          <button type="button" className="fld-ds" onClick={() => set({ [k]: want })}
            title={`Take ${g(want)} from the ${part.name} spec page`}>
            {off ? `spec page: ${g(want)}` : `use ${g(want)}`}
          </button>
        )}
      </label>
    );
  };

  // CurrentRange is the driver's one current; NodeCurrent is only for a current
  // settable per output. Getting it wrong drops the current out of Driver
  // Restrictions entirely and the driver reads as CC/CV undeclared.
  const currentMisplaced = draft.powerType === 'CC'
    && !numOrNull(draft.currentA) && numOrNull(draft.nodeCurrentA);

  // nCH in the ref counts DALI addresses.
  const refCh = /-(\d+)CH/i.exec(draft.typeRef || '')?.[1];
  const addr = numOrNull(draft.addresses);
  const refOff = refCh && addr != null && Number(refCh) !== addr;

  const outOfRange = part?.powerType === 'CC' && numOrNull(draft.currentA) != null
    && part.minA != null
    && (numOrNull(draft.currentA) < part.minA || numOrNull(draft.currentA) > part.maxA);

  const reach = reachableW(part, numOrNull(draft.currentA));

  return (
    <div className="preset-editor">
      {draft.invented ? (
        <div className="spec-pick">
          <label>
            <span>Part</span>
            <select className="form-select form-select-sm" value={draft.part ?? ''}
              onChange={(e) => {
                const d = PARTS.find((x) => x.name === e.target.value);
                setDraft({ ...draftFromPart(d, d?.kind === 'dcdc' ? chosenPsu : null), typeRef: '' });
              }}>
              <option value="">Choose a driver…</option>
              {PARTS.filter((p) => p.kind !== 'supply').map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </label>
          {/* A DC/DC driver has no rail of its own — the supply sets the voltage
              and caps the wattage, so the pair is the specification. */}
          {chosen?.kind === 'dcdc' && (
            <label>
              <span>Supply</span>
              <select className="form-select form-select-sm" value={draft.psu ?? ''}
                onChange={(e) => {
                  const psu = PARTS.find((x) => x.name === e.target.value);
                  setDraft({ ...draftFromPart(chosen, psu), typeRef: '' });
                }}>
                <option value="">Choose a PSU…</option>
                {PARTS.filter((p) => p.kind === 'supply').map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      ) : null}

      {/* The Ref is generated for a new type and fixed for an existing one — it
          is the key Elements point at, so it is never quietly rewritten. */}
      {draft.invented && (
        <label className="fld fld-ref">
          <span className="fld-col" title="Generated from the values below">Ref</span>
          <input value={draft.typeRef} placeholder="Ref"
            className={refOff ? 'is-off' : ''}
            onChange={(e) => { setOwnRef(true); set({ typeRef: e.target.value }); }} />
          {ownRef && (
            <button type="button" className="fld-ds" onClick={() => setOwnRef(false)}>
              use suggested
            </button>
          )}
          {refOff && <span className="fld-note">the Ref says {refCh}CH, the fields say {addr}</span>}
        </label>
      )}

      <div className="fld-sec">Driver</div>
      <div className="fld-grid">
        <label className="fld">
          <span className="fld-col" title="Constant current or constant voltage">Type</span>
          <select value={draft.powerType} onChange={(e) => set({ powerType: e.target.value })}>
            <option value="CC">CC</option>
            <option value="CV">CV</option>
          </select>
        </label>
        <Field col="MaxPower(W)" k="maxPowerW" tip="Total power, shared across all outputs" />
        {draft.powerType === 'CC'
          ? <Field col="CurrentRange" k="currentA" tip="Amps — one current for the whole driver" />
          : <Field col="OutputVoltage(V)" k="outputVoltageV" tip="Volts the driver puts out" />}
        <Field col="BallastCountPerUoM" k="addresses" tip="DALI addresses — the nCH in the Ref" step="1" />
        <label className="fld">
          <span className="fld-col" title="DALI, PHASE or Local">ControlType</span>
          <input value={draft.controlType} placeholder="—"
            onChange={(e) => set({ controlType: e.target.value })} />
        </label>
      </div>

      <div className="fld-sec">
        Per output
        {part && (
          <span className="fld-sec-note">
            {[part.powerType === 'CC' && part.minA != null && `${part.name} runs ${part.minA}–${part.maxA}A`,
              part.supply && `${part.maxPowerW}W at ${part.outputV}V`,
              reach != null && numOrNull(draft.maxPowerW) > reach && `reaches ${g(reach)}W at this current`,
            ].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
      <div className="fld-grid">
        <Field col="Parameters" k="outputs" tip="LED outputs — written as {<OP.1,<OP.2}" step="1" />
        <Field col="NodeMaxForwardVoltage(fV)" k="nodeMaxFvV" tip="Per output. Usually the limit that binds" />
        <Field col="NodeMaxPower(W)" k="nodeMaxLoadW" tip="Only if an output has its own cap" />
        <Field col="NodeCurrent" k="nodeCurrentA" tip="Amps. Only if current is settable per output" />
      </div>
      {outOfRange && (
        <div className="preset-warn">CurrentRange outside {part.minA}–{part.maxA}A for this part</div>
      )}
      {draft.powerType === 'CC' && numOrNull(draft.currentA) > 20 && (
        <div className="preset-warn">
          {draft.currentA}A — amps, not mA? That would be {numOrNull(draft.currentA) / 1000}A
        </div>
      )}
      {currentMisplaced && (
        <div className="preset-warn">
          Current is in NodeCurrent, so it will not reach Driver Restrictions.
          <button className="btn btn-sm btn-link p-0 ms-2 align-baseline"
            onClick={() => set({ currentA: draft.nodeCurrentA, nodeCurrentA: '' })}>
            Move to CurrentRange
          </button>
        </div>
      )}

      <div className="fld-foot">
        <button className="btn btn-sm btn-primary" disabled={!isComplete(draft)} onClick={onSave}>Save</button>
        <button className="btn btn-sm btn-link" onClick={onCancel}>Cancel</button>
        <span className="fld-foot-note">
          Saved here, and written to the workbook when you copy the patch
        </span>
        {onDelete && (
          <button className="btn btn-sm btn-link text-danger ms-auto" onClick={onDelete}>Remove</button>
        )}
      </div>
    </div>
  );
}
