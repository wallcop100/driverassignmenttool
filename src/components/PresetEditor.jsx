import { useEffect, useState } from 'react';
import { nextTypeRef, STOCK_TYPES } from '../engine.js';

// The driver type editor, shared by the Add-driver modal and the Driver types
// page. A preset is a rating nobody declared, supplied here and patched back
// into the workbook's ElementTypes row — see engine.js typeBlock.
// Ratings come from the driver type library when the host sends one; without it
// a per-hub payload has only the types already present, usually with no
// restrictions declared — hence the "not declared" fallback rather than a blank.
export function rating(t) {
  if (t.powerType === 'CC' && t.currentA != null) return `${t.currentA}A`;
  if (t.powerType === 'CV' && t.outputVoltageV != null) return `${t.outputVoltageV}V`;
  return null;
}

// A type in the catalogue, as the editor holds it. Everything is nullable: the
// point of the editor is that these are the values nobody declared.
export const draftFrom = (t) => ({
  typeRef: t.typeRef,
  name: t.name ?? '',
  powerType: t.powerType ?? 'CC',
  maxPowerW: t.maxPowerW ?? '',
  currentA: t.currentA ?? '',
  outputVoltageV: t.outputVoltageV ?? '',
  channels: t.nodes?.length ?? 1,
  nodeNames: t.nodes?.map((n) => n.name) ?? null,
  nodeMaxLoadW: t.nodes?.[0]?.maxLoadW ?? '',
  nodeMaxFvV: t.nodes?.[0]?.maxFvV ?? '',
  invented: false,
});

const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

// The page-135910 drivers, as an editor draft. Blank cells stay blank — on that
// page a blank means "no check", and inventing a limit here would invent a rule.
export const draftFromStock = (t) => ({
  typeRef: '', invented: true, stock: t.name,
  name: t.name,
  powerType: t.powerType,
  maxPowerW: t.maxPowerW ?? '',
  currentA: t.currentA ?? '',
  outputVoltageV: t.outputVoltageV ?? '',
  channels: t.channels,
  nodeNames: null,
  nodeMaxLoadW: t.nodeMaxLoadW ?? '',
  nodeMaxFvV: t.nodeMaxFvV ?? '',
  nodeCurrentA: t.nodeCurrentA ?? null,
  ballast: t.ballast ?? null,
  controlType: t.controlType ?? null,
  stem: t.stem ?? null,
});

// Saved shape — numbers, not form strings.
export const toPreset = (d) => ({
  typeRef: d.typeRef.trim(),
  name: (d.name ?? '').trim(),
  powerType: d.powerType,
  maxPowerW: numOrNull(d.maxPowerW),
  currentA: d.powerType === 'CC' ? numOrNull(d.currentA) : null,
  outputVoltageV: d.powerType === 'CV' ? numOrNull(d.outputVoltageV) : null,
  channels: Math.max(1, Number(d.channels) || 1),
  nodeNames: d.nodeNames ?? null,
  nodeCurrentA: d.nodeCurrentA ?? null,
  ballast: d.ballast ?? null,
  controlType: d.controlType ?? null,
  nodeMaxLoadW: numOrNull(d.nodeMaxLoadW),
  nodeMaxFvV: numOrNull(d.nodeMaxFvV),
  invented: !!d.invented,
});

// Enough to size against: without a declared type, rating and max power, the
// planner refuses it anyway (sizingCandidates) and we would have saved a preset
// that changes nothing.
const isComplete = (d) => !!d.typeRef.trim() && numOrNull(d.maxPowerW) > 0
  && (d.powerType === 'CC' ? numOrNull(d.currentA) > 0 : numOrNull(d.outputVoltageV) > 0);

export default function PresetEditor({ draft, setDraft, inventory, onSave, onCancel, onDelete }) {
  const set = (patch) => setDraft({ ...draft, ...patch });
  // The ref encodes the spec in this library, so it is re-proposed as the
  // ratings change — until the user types their own, after which it is theirs.
  const [ownRef, setOwnRef] = useState(false);
  useEffect(() => {
    if (!draft.invented || ownRef) return;
    const next = nextTypeRef(inventory, {
      powerType: draft.powerType,
      currentA: numOrNull(draft.currentA),
      outputVoltageV: numOrNull(draft.outputVoltageV),
      channels: Math.max(1, Number(draft.channels) || 1),
      stem: draft.stem,
    });
    if (next && next !== draft.typeRef) set({ typeRef: next });
  }, [draft.powerType, draft.currentA, draft.outputVoltageV, draft.channels, ownRef]);

  const field = (label, key, extra = {}) => (
    <label className="preset-field">
      <span>{label}</span>
      <input className="form-control form-control-sm" type="number" min="0" step="any"
        value={draft[key]} onChange={(e) => set({ [key]: e.target.value })} {...extra} />
    </label>
  );

  return (
    <div className="preset-editor px-3 py-3">
      <div className="d-flex align-items-center gap-2 mb-2">
        <strong className="small">{draft.invented ? 'New driver type' : `Ratings for ${draft.typeRef}`}</strong>
        <span className="badge text-bg-warning ms-auto">provisional</span>
      </div>

      {draft.invented && (
        <div className="stock-row mb-2">
          <span className="text-secondary">Start from</span>
          {STOCK_TYPES.map((t) => (
            <button key={t.name} type="button"
              className={`stock-chip ${draft.stock === t.name ? 'is-on' : ''}`}
              onClick={() => setDraft({ ...draftFromStock(t), typeRef: '' })}>
              {t.name}
            </button>
          ))}
        </div>
      )}

      {draft.invented && (
        <label className="preset-field mb-2 w-100">
          <span>Type ref</span>
          <input className="form-control form-control-sm" value={draft.typeRef}
            onChange={(e) => { setOwnRef(true); set({ typeRef: e.target.value }); }} />
        </label>
      )}

      <div className="preset-grid">
        <label className="preset-field">
          <span>Type</span>
          <select className="form-select form-select-sm" value={draft.powerType}
            onChange={(e) => set({ powerType: e.target.value })}>
            <option value="CC">CC</option>
            <option value="CV">CV</option>
          </select>
        </label>
        {field('Max power (W)', 'maxPowerW')}
        {draft.powerType === 'CC'
          ? field('Current (A)', 'currentA')
          : field('Output (V)', 'outputVoltageV')}
        {/* No silent divide: a driver really rated 20A+ exists, so say what this
            looks like and let the person decide. */}
        {draft.powerType === 'CC' && numOrNull(draft.currentA) > 20 && (
          <span className="preset-hint">
            {draft.currentA}A — did you mean {numOrNull(draft.currentA) / 1000}A ({draft.currentA}mA)?
          </span>
        )}
        {field('Channels', 'channels', { min: '1', step: '1' })}
        {field('Node max (W)', 'nodeMaxLoadW')}
        {field('Node max fV', 'nodeMaxFvV')}
      </div>

      <p className="text-secondary mt-2 mb-2" style={{ fontSize: '12px' }}>
        Patched into the workbook’s <code>ElementTypes</code> row and marked
        <code> IsPropertiesTBC</code>. Current is written in amps, and the channels
        become <code>Parameters</code> — <code>{'{<OP.1,<OP.2}'}</code>.
        {draft.stock && ' Values are the documented ones for this driver; a blank cell means no check.'}
      </p>

      <div className="d-flex gap-2">
        <button className="btn btn-sm btn-primary" disabled={!isComplete(draft)} onClick={onSave}>
          Save preset
        </button>
        <button className="btn btn-sm btn-outline-secondary" onClick={onCancel}>Cancel</button>
        {onDelete && (
          <button className="btn btn-sm btn-link text-danger ms-auto" onClick={onDelete}>
            Remove preset
          </button>
        )}
      </div>
    </div>
  );
}

