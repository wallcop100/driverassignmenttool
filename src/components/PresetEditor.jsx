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
    nodeNames: null,
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

  const field = (col, key, tip, extra = {}) => {
    const want = spec[key];
    const has = numOrNull(draft[key]);
    const off = want != null && has != null && Math.abs(has - want) > 1e-9;
    return (
      <label className="preset-field">
        <span title={tip}>{col}</span>
        <input className={`form-control form-control-sm ${off ? 'is-off' : ''}`}
          type="number" min="0" step="any" value={draft[key]}
          onChange={(e) => set({ [key]: e.target.value })} {...extra} />
        {want != null && (
          <em className={off ? 'spec-off' : 'spec-ok'}>datasheet {g(want)}</em>
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
    <div className="preset-editor px-3 py-3">
      <div className="d-flex align-items-center gap-2 mb-2">
        <strong className="small">{draft.invented ? 'New ElementType' : draft.typeRef}</strong>
        <span className="badge text-bg-warning ms-auto" title="Patched as IsPropertiesTBC">provisional</span>
      </div>

      {draft.invented && (
        <div className="preset-grid mb-2">
          <label className="preset-field">
            <span title="Fills the fields from that part's Driver Specs page">Datasheet</span>
            <select className="form-select form-select-sm" value={draft.part ?? ''}
              onChange={(e) => {
                const d = PARTS.find((x) => x.name === e.target.value);
                setDraft({ ...draftFromPart(d, d?.kind === 'dcdc' ? chosenPsu : null), typeRef: '' });
              }}>
              <option value="">—</option>
              {PARTS.filter((p) => p.kind !== 'supply').map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </label>
          {/* A DC/DC driver has no rail of its own: the supply sets the voltage
              and caps the wattage, so the pair is the specification. */}
          {chosen?.kind === 'dcdc' && (
            <label className="preset-field">
              <span title="The supply feeding it — sets OutputVoltage(V) and caps MaxPower(W)">PSU</span>
              <select className="form-select form-select-sm" value={draft.psu ?? ''}
                onChange={(e) => {
                  const psu = PARTS.find((x) => x.name === e.target.value);
                  setDraft({ ...draftFromPart(chosen, psu), typeRef: '' });
                }}>
                <option value="">—</option>
                {PARTS.filter((p) => p.kind === 'supply').map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            </label>
          )}
          <label className="preset-field">
            <span title="ElementTypes.Ref — nCH counts DALI addresses">Ref</span>
            <input className={`form-control form-control-sm ${refOff ? 'is-off' : ''}`}
              value={draft.typeRef}
              onChange={(e) => { setOwnRef(true); set({ typeRef: e.target.value }); }} />
            {refOff && <em className="spec-off">{addr} addresses</em>}
          </label>
        </div>
      )}

      <div className="preset-grid">
        <label className="preset-field">
          <span title="Constant current or constant voltage">Type</span>
          <select className="form-select form-select-sm" value={draft.powerType}
            onChange={(e) => set({ powerType: e.target.value })}>
            <option value="CC">CC</option>
            <option value="CV">CV</option>
          </select>
        </label>

        {field('MaxPower(W)', 'maxPowerW', 'Total power, shared across all outputs')}

        {draft.powerType === 'CC'
          ? field('CurrentRange', 'currentA', 'Amps, one current for the whole driver')
          : field('OutputVoltage(V)', 'outputVoltageV', 'Volts the driver puts out')}

        {field('Parameters', 'outputs', 'LED outputs — written as {<OP.1,<OP.2}', { min: '1', step: '1' })}
        {field('BallastCountPerUoM', 'addresses', 'DALI addresses — the nCH in the Ref', { step: '1' })}
        {field('NodeMaxForwardVoltage(fV)', 'nodeMaxFvV', 'Per output. Usually the limit that binds')}
        {field('NodeMaxPower(W)', 'nodeMaxLoadW', 'Only if an output has its own cap')}
        {field('NodeCurrent', 'nodeCurrentA', 'Amps. Only if current is settable per output')}

        <label className="preset-field">
          <span title="DALI, PHASE or Local">ControlType</span>
          <input className="form-control form-control-sm" value={draft.controlType}
            onChange={(e) => set({ controlType: e.target.value })} />
          {spec.controlType && <em className="spec-ok">datasheet {spec.controlType}</em>}
        </label>
      </div>

      {part && (
        <div className="preset-note">
          {part.name}
          {part.powerType === 'CC' && part.minA != null && ` · ${part.minA}–${part.maxA}A`}
          {part.supply && ` · ${part.maxPowerW}W at ${part.outputV}V`}
          {reach != null && numOrNull(draft.maxPowerW) > reach && ` · reaches ${g(reach)}W here`}
        </div>
      )}
      {outOfRange && (
        <div className="preset-warn">
          CurrentRange outside {part.minA}–{part.maxA}A for this part
        </div>
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

      <div className="d-flex gap-2 mt-3">
        <button className="btn btn-sm btn-primary" disabled={!isComplete(draft)} onClick={onSave}>Save</button>
        <button className="btn btn-sm btn-outline-secondary" onClick={onCancel}>Cancel</button>
        {onDelete && (
          <button className="btn btn-sm btn-link text-danger ms-auto" onClick={onDelete}>Remove</button>
        )}
      </div>
    </div>
  );
}
