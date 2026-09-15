import { useMemo, useState } from 'react';
import * as api from '../api.js';
import * as draw from '../core/draw.js';
import { panelPatch, rowFor } from './panelPatch.js';
import './PanelLayout.css';

// A control panel's arrangement, edited the way DJ 101676 draws it: one row per
// way the panel type declares, a label box on the left, the modules in that way
// side by side. Drag a module into another way; drag it to the tray to take it
// out of every way.
//
// It is a SCHEMATIC, as 101676 says of its own drawing: widths come from a
// module's [x,,] where one is declared and are clamped for legibility, so do not
// measure anything off it.

// Fill by class, as 101676 fills them.
const classOf = (m) => {
  const t = `${m.typeRef ?? ''} ${m.name ?? ''}`.toUpperCase();
  if (/DALI|\bDLI\b|DIN-DLI|\bDAL\b/.test(t)) return 'signal';
  if (/PROC|AP4|DIN-HUB|MOD-HUB|CEN-?CN|QSX/.test(t)) return 'processor';
  if (/KPL|KEYPAD/.test(t)) return 'keypad';
  if (/PANDUIT|TRUNK|LANDING|WLB/.test(t)) return 'passive';
  return 'blank';
};

const NOMINAL_MM = 70;   // four DIN modules, for a type that declares no [x,,]

// Measure lettering in the font the block actually renders, bold as it is drawn.
// An estimate from the character count kept cutting the last letter off long
// refs, because the width of a face depends on which face the browser found.
let ctx2d = null;
const measureBold = (text, size) => {
  if (!ctx2d) ctx2d = document.createElement('canvas').getContext('2d');
  ctx2d.font = `700 ${size}px Helvetica, Arial, sans-serif`;
  return ctx2d.measureText(String(text)).width;
};
const ROW_PX = 56;

function Module({ m, zoom, moved, dragging, onDragStart, onDragEnd }) {
  const width = draw.scaler('schematic', 1.6)(m.sizeMm?.[0] ?? NOMINAL_MM) * zoom;
  const height = ROW_PX * zoom;
  const fill = draw.fillFor(classOf(m));
  const ink = draw.inkFor(fill);
  const label = String(m.typeRef ?? '').replace(/^ET-/, '');
  const plan = draw.labelPlan(label, draw.subLabel(m.ref, m.sizeMm?.[0]), width, height,
    // the block has 8px of padding each side and a 1.5px border, so the room for
    // lettering is its width less 19, not less the fitter's default 8
    { base: 12 * zoom, min: 7, pad: 19, measure: measureBold });
  return (
    <div className={`pl-mod ${plan.mode === 'turned' ? 'is-turned' : ''} ${moved ? 'is-moved' : ''} ${dragging ? 'is-drag' : ''}`}
      draggable onDragStart={onDragStart} onDragEnd={onDragEnd}
      style={{ width, height, background: fill, color: ink }}
      title={`${m.ref} ${m.name || m.typeRef}${moved ? ' (moved, not patched yet)' : ''}`}>
      {plan.mode === 'across' && (
        <>
          <b style={{ fontSize: plan.size }}>{label}</b>
          {plan.sub && <span style={{ fontSize: plan.size * 0.8 }}>{plan.sub}</span>}
        </>
      )}
      {plan.mode === 'turned' && <b className="pl-turned" style={{ fontSize: plan.size }}>{label}</b>}
    </div>
  );
}

export default function PanelLayout({ state, zone = null, onBack = null }) {
  const { model } = state;
  const panels = model.panels ?? [];
  const [panelRef, setPanelRef] = useState(panels.some((p) => p.ref === zone) ? zone : panels[0]?.ref ?? null);
  const [ways, setWays] = useState({});          // module ref -> way, edits only
  const [hist, setHist] = useState({ undo: [], redo: [] });
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [copied, setCopied] = useState(false);

  const panel = panels.find((p) => p.ref === panelRef) ?? null;
  const rows = panel?.slots ?? [];
  const modules = useMemo(() => model.drivers.filter((m) => m.zone === panelRef), [model, panelRef]);
  const wayOf = (m) => (Object.prototype.hasOwnProperty.call(ways, m.ref) ? ways[m.ref] : (m.slot ?? ''));
  const isMoved = (m) => wayOf(m) !== (m.slot ?? '');

  const change = (next) => { setHist((h) => ({ undo: [...h.undo, ways], redo: [] })); setWays(next); };
  const undo = () => setHist((h) => {
    if (!h.undo.length) return h;
    setWays(h.undo[h.undo.length - 1]);
    return { undo: h.undo.slice(0, -1), redo: [...h.redo, ways] };
  });
  const redo = () => setHist((h) => {
    if (!h.redo.length) return h;
    setWays(h.redo[h.redo.length - 1]);
    return { undo: [...h.undo, ways], redo: h.redo.slice(0, -1) };
  });

  const dropInto = (rowName) => {
    const m = modules.find((x) => x.ref === drag);
    setDrag(null); setOver(null);
    if (!m) return;
    // Going back to the way it came from keeps its own spelling (<01.a>), so an
    // undone move is not a change to patch. A new way is written as declared.
    const to = rowName == null ? ''
      : (m.slot && rowFor(m.slot, rows) === rowName ? m.slot : rowName);
    if (to !== wayOf(m)) change({ ...ways, [m.ref]: to });
  };

  const moves = modules.filter(isMoved).map((m) => ({ ref: m.ref, to: wayOf(m) }));
  const unplaced = modules.filter((m) => rowFor(wayOf(m), rows) == null);

  const copyPatch = async () => {
    await api.copyPatch(panelPatch(moves));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const card = (m) => (
    <Module key={m.ref} m={m} zoom={zoom} moved={isMoved(m)} dragging={drag === m.ref}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDrag(m.ref); }}
      onDragEnd={() => { setDrag(null); setOver(null); }} />
  );

  if (!panel) return <div className="container py-4 text-secondary">No panels in this data.</div>;

  return (
    <div className="pl">
      <div className="pl-head">
        {onBack && (
          <button className="btn btn-sm btn-outline-secondary d-flex align-items-center"
            onClick={onBack} title="Back to assigning this panel">
            <span className="material-icons small-icon">arrow_back</span> Assign
          </button>
        )}
        <select className="form-select form-select-sm" style={{ width: 'auto' }} value={panelRef}
          onChange={(e) => { setPanelRef(e.target.value); setHist({ undo: [], redo: [] }); }}>
          {panels.map((p) => <option key={p.ref} value={p.ref}>{p.name} ({p.typeRef})</option>)}
        </select>
        <span className="pl-count">
          {modules.length - unplaced.length} of {modules.length} modules in a way
        </span>
        <span className="pl-zoom" title="Zoom">
          <button onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(1)))}>-</button>
          {Math.round(zoom * 100)}%
          <button onClick={() => setZoom((z) => Math.min(2, +(z + 0.2).toFixed(1)))}>+</button>
        </span>
        <span className="ms-auto d-flex align-items-center gap-2">
          <button className="btn btn-sm btn-outline-secondary" disabled={!hist.undo.length} onClick={undo} title="Undo">
            <span className="material-icons small-icon align-middle">undo</span></button>
          <button className="btn btn-sm btn-outline-secondary" disabled={!hist.redo.length} onClick={redo} title="Redo">
            <span className="material-icons small-icon align-middle">redo</span></button>
          <button className="btn btn-sm btn-primary" disabled={!moves.length} onClick={copyPatch}
            title="Copy an ExcelScript patch that writes each moved module's way into Elements.ContextParameters">
            <span className="material-icons small-icon align-middle">{copied ? 'check' : 'content_copy'}</span>
            {copied ? ' Copied' : ` Copy patch (${moves.length})`}
          </button>
        </span>
      </div>

      <div className={`pl-tray ${over === 'tray' ? 'is-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver('tray'); }}
        onDragLeave={() => setOver(null)}
        onDrop={(e) => { e.preventDefault(); dropInto(null); }}>
        <span className="pl-tray-title">Not in a way</span>
        {unplaced.length ? unplaced.map(card) : <span className="pl-empty">every module is in a way</span>}
      </div>

      {rows.length === 0 ? (
        <div className="alert alert-secondary">
          {panel.typeRef} declares no ways, so there is nothing to arrange into. Add its
          {' '}<code>&lt;01,02,...&gt;</code> recipe to the ElementType's Parameters.
        </div>
      ) : (
        <div className="pl-board">
          {rows.map((r, i) => {
            const key = `r${i}`;
            const inRow = r.blank ? [] : modules.filter((m) => rowFor(wayOf(m), rows) === r.name);
            return (
              <div key={key} className={`pl-row ${over === key ? 'is-over' : ''}`}
                onDragOver={r.blank ? undefined : (e) => { e.preventDefault(); setOver(key); }}
                onDragLeave={() => setOver(null)}
                onDrop={r.blank ? undefined : (e) => { e.preventDefault(); dropInto(r.name); }}>
                <div className="pl-label">{r.blank ? 'spare' : `Position ${r.name}`}</div>
                <div className="pl-rail" style={{ minHeight: ROW_PX * zoom + 12 }}>
                  {r.blank
                    ? <div className="pl-spare">{draw.SPARE_LABEL}</div>
                    : inRow.length ? inRow.map(card) : <span className="pl-empty">empty</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="pl-note">
        A schematic, as DJ 101676 draws it: widths come from a module's [x,,] where
        declared and are clamped to stay readable. A dashed outline is a move that
        has not been patched yet.
      </p>
    </div>
  );
}
