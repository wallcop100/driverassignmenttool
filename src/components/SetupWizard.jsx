import { useMemo, useState, useSyncExternalStore } from 'react';
import { NO_SUPPLY, allParts, atCurrent, checkOf, combine, driverTypes, matchParts, resolveSpec, sharedSupply } from '../engine.js';
import { onSharedParts, sharedSnapshot } from '../catalogue.js';
import SharedCheck, { ReportSuggestion } from './SharedCheck.jsx';
import PresetEditor, { draftFrom, draftFromPart, toPreset } from './PresetEditor.jsx';
import { FamilyStep, Pill, Review } from './Families.jsx';
import {
  QUESTIONS, currentOptions, familyPreset, fixPreset, fmt, fromShared, identify, known, narrow, nextQuestion, precedent,
} from '../typeFaults.js';

// Onboarding a project to Lighting DesignDB V4.6. Every driver ElementType on
// the job states none of the ten attributes the checks run on, so nothing here
// works: every driver is undetermined, nothing can be sized, every check is
// skipped. It is the same handful of rows for the whole project, so it is one
// job to do once rather than a fault to flag on each type.
//
// About 90% of a project is the same few products at different currents. So
// the walk is one product family per step, confirmed in one click, then a
// review of what was set aside or matched no product. Only those get the
// questions, and a group of lookalikes is asked about once.

// Everything the Name and the Ref already answer, so the step opens with them
// filled in rather than asking again. "LinDrive 200D & Meanwell HLG-185-24"
// names its supply; ET-CCR-D-350-1CH-01 names its current. Leaving those blank
// made the wizard ask about types that needed no asking.
const stepFor = (t) => {
  const spec = resolveSpec(t.name || t.typeRef);
  const part = spec?.driver ?? spec ?? null;
  const opts = currentOptions(t, spec);
  return {
    t,
    spec,
    part,
    supply: spec?.supply ?? (part?.kind === 'dcdc' ? sharedSupply(part) : null),
    currentMa: opts.length ? String(Math.round(opts[0].a * 1000)) : '',
    known: known(t),
  };
};

export default function SetupWizard({ model, presets, dispatch, onClose, only }) {
  // Only the types this walk is about. From the types page that is the ones in
  // use - a library of forty parts nobody has placed is not what you came to
  // fill in - and the caller says so rather than the wizard guessing.
  const inventory = useMemo(
    () => (only ? model.inventory.filter((t) => only.has(t.typeRef)) : model.inventory),
    [model.inventory, only],
  );
  // a check of a shared part changes what can be identified
  const sharedSet = useSyncExternalStore(onSharedParts, sharedSnapshot);
  const { families, rest } = useMemo(() => identify(inventory, resolveSpec), [inventory, sharedSet]);
  const [at, setAt] = useState(0);             // families.length is the review
  const [out, setOut] = useState(() => new Set());
  const [ask, setAsk] = useState(null);        // { types, fresh?, hand? }
  const done = inventory.filter((t) => presets[t.typeRef]).length;

  const f = families[at];
  const kept = f ? f.types.filter((x) => !out.has(x.t.typeRef)) : [];
  const aside = families.flatMap((fam) => fam.types.filter((x) => out.has(x.t.typeRef)).map((x) => ({ ...x, f: fam })));
  const toggle = (ref) => { const s = new Set(out); if (s.has(ref)) s.delete(ref); else s.add(ref); setOut(s); };
  const set = (preset) => dispatch({ type: 'SET_PRESET', preset });

  const yes = () => {
    for (const x of kept) set(x.preset);
    setAt(at + 1);
  };
  const n = kept.length;

  return (
    <div className="nt-backdrop">
      <div className={`nt-dialog ${ask ? 'sw-dialog' : 'tr-dialog'}`} role="dialog" aria-label="Set up driver attributes">
        <div className="nt-head">
          <b>Driver attributes</b>
          <span className="text-secondary small">{done} of {inventory.length} filled in</span>
          <button className="btn btn-sm btn-link ms-auto p-0" onClick={onClose}>close</button>
        </div>

        {ask ? (
          <Ask key={ask.types[0].typeRef} {...ask} model={model} presets={presets} dispatch={dispatch} onDone={() => setAsk(null)} />
        ) : (
          <>
            <div className="tr-steps">
              {families.map((fam, i) => (
                <button key={fam.key} type="button" onClick={() => setAt(i)}
                  className={`tr-step ${i === at ? 'is-on' : fam.types.every((x) => presets[x.t.typeRef]) ? 'is-done' : ''}`}>
                  {fam.part.name} · {fam.types.length}
                </button>
              ))}
              <button type="button" className={`tr-step ${at === families.length ? 'is-on' : ''}`} onClick={() => setAt(families.length)}>
                Review
              </button>
            </div>
            {f
              ? <FamilyStep f={f} out={out} toggle={toggle} />
              : <Review aside={aside} rest={rest} presets={presets} onAsk={setAsk}
                  onOwn={(x) => set(fixPreset(x.t, x.f.spec, 'fill', x.currentA))}
                  onBack={(x) => { set(x.preset); toggle(x.t.typeRef); }} />}
            <div className="tr-foot">
              {at > 0 && <button className="btn btn-sm btn-link" onClick={() => setAt(at - 1)}>Back</button>}
              {f
                ? <button className="btn btn-primary ms-auto" onClick={n ? yes : () => setAt(at + 1)}>
                    {n ? `Yes, ${n === 1 ? (f.types.length === 1 ? 'it is' : 'this one is') : n === f.types.length ? `all ${n} are` : `these ${n} are`} ${f.part.name}` : 'None of these'} →
                  </button>
                : <button className="btn btn-primary ms-auto" onClick={onClose}>Done</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// The questions, for one type or a group of lookalikes: asked about the first,
// and the answer written to every one, each at its own current. `fresh` starts
// with the part cleared ("it's a different product"); `hand` opens the columns.
function Ask({ model, presets, dispatch, types, fresh, hand: byHand, onDone }) {
  const parts = allParts();   // the datasheets, then any shared additions
  const sharedSet = useSyncExternalStore(onSharedParts, sharedSnapshot);
  const step = useMemo(() => stepFor(types[0]), [types, sharedSet]);
  const key = step.t.typeRef;
  const [draft, setDraft] = useState(() => (byHand ? draftFrom(step.t) : null));
  const [picked, setPicked] = useState(() => (fresh ? { part: '' } : {}));   // { part, psu, currentA, ans }
  // what this project's filled-in drivers use, to order the buttons by
  const prec = useMemo(() => precedent(driverTypes(model), resolveSpec), [model, sharedSet]);

  // What the name resolved to, unless the user has said otherwise. `undefined`
  // means untouched, so the match stands; an empty string means they cleared it.
  const part = parts.find((p) => p.name === picked.part) ?? (picked.part == null ? step.part : null);
  // a part picked here brings its own agreed supply, not the one the name gave
  const psu = picked.psu == null
    ? (picked.part ? sharedSupply(part) : step.supply)
    : (parts.find((p) => p.name === picked.psu) ?? null);
  const currentMa = picked.currentA ?? step.currentMa;
  const spec = part ? combine(part, part.kind === 'dcdc' ? psu : null) : null;
  const needsPsu = part?.kind === 'dcdc';
  const needsCurrent = spec?.powerType === 'CC' && !(spec.minA != null && spec.minA === spec.maxA);
  const unchecked = [part, needsPsu ? psu : null].filter((p) => checkOf(p) === 'unchecked');
  const ready = !!spec && (!needsPsu || psu || picked.psu === NO_SUPPLY) && (!needsCurrent || Number(currentMa) > 0);
  const set = (patch) => setPicked({ ...picked, ...patch });

  // What the tool would write for this type: the datasheet's values, the node
  // list the part defines, and the Ref kept exactly as the DesignDB has it.
  const proposed = () => {
    const d = draftFromPart(atCurrent(part, needsCurrent ? Number(currentMa) / 1000 : null), needsPsu ? psu : null);
    return toPreset({
      ...d,
      typeRef: step.t.typeRef,
      name: step.t.name || d.name,
      currentA: needsCurrent ? Number(currentMa) / 1000 : (spec.minA ?? ''),
      invented: false,
    });
  };

  // by hand, carrying whatever the questions already settled
  const hand = () => {
    const ans = answersOf(step, picked);
    setDraft(draftFrom({
      ...step.t,
      powerType: ans.powerType ?? step.t.powerType,
      controlType: ans.controlType ?? step.t.controlType,
      outputs: ans.outputs ?? undefined,
      currentA: Number(currentMa) > 0 ? Number(currentMa) / 1000 : ans.currentA ?? step.t.currentA,
    }));
  };

  // The first type, then its lookalikes: from the part at their own current
  // when there is one, or a copy of the columns filled in by hand.
  const write = (first, fromPart) => {
    dispatch({ type: 'SET_PRESET', preset: first });
    for (const s of types.slice(1)) {
      const preset = fromPart
        ? familyPreset(s, spec, needsCurrent ? currentOptions(s, spec)[0]?.a ?? first.currentA : null)
        : { ...first, typeRef: s.typeRef, name: s.name || first.name };
      dispatch({ type: 'SET_PRESET', preset });
    }
    onDone();
  };

  return (
    <>
      <div className="sw-body">
        <div className="sw-head">
          <Pill t={step.t} />
          <span className="tp-name">{step.t.name || '-'}</span>
          {types.length > 1 && <span className="text-secondary small">and {types.length - 1} more like it</span>}
          {presets[key] && <span className="tp-dot">filled in</span>}
        </div>

        {!draft && (
          <>
            <Questions key={key} {...{ step, parts, picked, set, part, psu, needsPsu, needsCurrent, spec, currentMa, prec, hand }} />

            {unchecked.map((p) => (
              <SharedCheck key={p.name} part={p} />
            ))}

            {ready ? (
              <div className="sw-preview">
                <div className="fld-sec">This writes
                  {fromShared(spec) && !unchecked.length && (
                    <span className="sw-sug" title="Not from a spec page: other projects use these values, agreed by two people">
                      <span className="material-icons">auto_awesome</span>Suggested
                      <ReportSuggestion what={part.name} />
                    </span>
                  )}
                </div>
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
                        <td className="sw-val">{v == null || v === '' ? '-' : fmt(v) ?? v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-secondary small mt-2 mb-0">
                  Blank means no check. Numbers only, and amps rather than milliamps.
                </p>
              </div>
            ) : null}
          </>
        )}

        {draft && (
          <PresetEditor draft={draft} setDraft={setDraft} inventory={model.inventory}
            onSave={() => write(toPreset(draft), false)}
            onCancel={() => (byHand ? onDone() : setDraft(null))} />
        )}
      </div>

      {!draft && (
        <div className="nt-foot">
          <button className="btn btn-sm btn-link nt-all"
            onClick={() => (ready ? setDraft(draftFrom({ ...step.t, ...proposed() })) : hand())}>
            Fill it in by hand
          </button>
          <button className="btn btn-sm btn-outline-secondary" onClick={onDone}>Back to the review</button>
          <button className="btn btn-sm btn-primary" disabled={!ready || unchecked.length > 0}
            onClick={() => write({ ...proposed(), origin: fromShared(spec) ? 'shared' : 'datasheet' }, true)}
            title={unchecked.length ? 'A suggested part needs a second person to check it first' : undefined}>
            {types.length > 1 ? `Use this for all ${types.length}` : 'Use this'}
          </button>
        </div>
      )}
    </>
  );
}

// The type's own answers, then the ones given here. A null given here re-asks
// one the type answered.
const answersOf = (step, picked) => ({
  ...Object.fromEntries(Object.entries(step.known).map(([k, [v]]) => [k, v])),
  ...picked.ans,
});

const ASK = {
  powerType: ['CC or CV?', 'Constant current drives LEDs directly; constant voltage feeds tape.'],
  controlType: ['How is it controlled?', 'The ControlType column.'],
  outputs: ['How many outputs?', 'One OP.n node per output.'],
};
const LABEL = {
  powerType: (v) => v,
  controlType: (v) => ({ Local: 'Local (no dimming)', PHASE: 'Phase dimmed' })[v] ?? v,
  outputs: (v) => `${v} output${Number(v) === 1 ? '' : 's'}`,
};
const used = (n) => (n ? `used by ${n} type${n === 1 ? '' : 's'} here` : '');
const COMMON_MA = [350, 500, 700, 1050];

// A part someone using the tool sent: "suggested" once two people agree it,
// "to check" until then (it is asked about in the card once picked).
const sug = (p) => p?.shared && (checkOf(p) === 'unchecked' ? 'to check' : 'suggested');

function Opt({ label, sub, tag, top, part, onClick }) {
  const s = sug(part);
  return (
    <button type="button" className={`q-opt ${top ? 'is-top' : ''}`} onClick={onClick}>
      <b>{label}</b>
      {sub && <span>{sub}</span>}
      {tag && <span className="q-tag">{tag}</span>}
      {s && <span className="q-sug"><span className="material-icons">auto_awesome</span>{s}</span>}
      {!s && part?.discontinued && <span>discontinued</span>}
    </button>
  );
}

// The free-text way out of every question: an answer that isn't a button.
function Other({ placeholder, onUse, type = 'text' }) {
  const [v, setV] = useState('');
  return (
    <form className="q-other" onSubmit={(e) => { e.preventDefault(); if (v.trim()) onUse(v.trim()); }}>
      <input className="form-control form-control-sm" type={type} placeholder={placeholder}
        value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn btn-sm btn-outline-primary" disabled={!v.trim()}>Use this</button>
    </form>
  );
}

// "Which driver is this?" as a run of buttons. What the type already says is a
// crumb, not a question; a crumb clicked asks it again. An answer no part fits
// hands over to the columns, with the answers so far filled in.
function Questions({ step, parts, picked, set, part, psu, needsPsu, needsCurrent, spec, currentMa, prec, hand }) {
  const [miss, setMiss] = useState(null);   // a typed answer nothing matched
  const ans = answersOf(step, picked);
  const from = (key) => picked.ans?.[key] === undefined && step.known[key]?.[1];
  const reask = (key) => { setMiss(null); set({ ans: { ...picked.ans, [key]: null }, part: '', psu: undefined, currentA: undefined }); };
  const answer = (key, v) => { setMiss(null); set({ ans: { ...picked.ans, [key]: v } }); };
  const rank = (key) => (a, b) => (prec[key]?.[b] ?? 0) - (prec[key]?.[a] ?? 0);

  const crumbs = [
    ...QUESTIONS.filter((k) => ans[k] != null).map((k) => ({ k, label: LABEL[k](ans[k]), from: from(k), go: () => reask(k) })),
    part && { k: 'part', label: part.name, from: !picked.part && 'name', go: () => { setMiss(null); set({ part: '', psu: undefined, currentA: undefined }); } },
    needsPsu && (psu || picked.psu === NO_SUPPLY) && {
      k: 'psu', label: psu?.name ?? 'No supply', go: () => set({ psu: '' }),
      from: picked.psu == null && (!picked.part && step.spec?.supply ? 'name' : 'suggestion'),
    },
    needsCurrent && Number(currentMa) > 0 && { k: 'cur', label: `${currentMa} mA`, go: () => set({ currentA: '' }) },
  ].filter(Boolean);

  let body = null;
  const cands = part ? [] : narrow(parts, ans);
  const q = part ? null : nextQuestion(cands, ans);
  if (miss || (!part && !cands.length)) {
    body = (
      <div className="q-none">
        {miss ? `Nothing in the catalogue matches “${miss}”.` : 'No part in the catalogue fits these answers.'}
        {' '}Fill the columns in yourself - what you answered is carried over.
        <button className="btn btn-sm btn-primary ms-2" onClick={hand}>Fill in the columns</button>
      </div>
    );
  } else if (q) {
    const vals = q.key === 'powerType' ? ['CC', 'CV'] : Object.keys(q.groups);
    vals.sort((a, b) => rank(q.key)(a, b) || (q.groups[b] ?? 0) - (q.groups[a] ?? 0));
    body = (
      <>
        <div className="q-ask">{ASK[q.key][0]}</div>
        <div className="q-why">{ASK[q.key][1]}</div>
        <div className="q-opts">
          {vals.map((v, n) => (
            <Opt key={v} label={LABEL[q.key](v)} top={n === 0 && prec[q.key]?.[v]}
              sub={`${q.groups[v] ?? 0} part${q.groups[v] === 1 ? '' : 's'}`} tag={used(prec[q.key]?.[v])}
              onClick={() => answer(q.key, q.key === 'outputs' ? Number(v) : v)} />
          ))}
        </div>
        {q.key !== 'powerType' && (
          <Other placeholder="Something else - type it" type={q.key === 'outputs' ? 'number' : 'text'}
            onUse={(v) => answer(q.key, q.key === 'outputs' ? Number(v) : v)} />
        )}
        <div className="q-left">{cands.length} parts still possible</div>
      </>
    );
  } else if (!part) {
    const list = [...cands].sort((a, b) => rank('part')(a.name, b.name) || (b.common ? 1 : 0) - (a.common ? 1 : 0));
    body = (
      <>
        <div className="q-ask">Which driver is it?</div>
        <div className="q-why">{list.length} part{list.length === 1 ? ' fits' : 's fit'} what you have said.</div>
        <div className="q-opts">
          {list.map((p, n) => (
            <Opt key={p.name} label={p.name} top={n === 0 && prec.part[p.name]}
              sub={`${fmt(p.maxPowerW) ?? '-'}W · ${p.outputs != null ? `${p.outputs} out · ` : ''}${p.controlType ?? '-'}${p.minA != null ? ` · ${p.minA * 1000}–${p.maxA * 1000}mA` : ''}${p.kind === 'supply' ? ' · supply alone' : ''}`}
              tag={used(prec.part[p.name])} part={p}
              onClick={() => set({ part: p.name, psu: undefined, currentA: undefined })} />
          ))}
        </div>
        <Other placeholder="Part name or code, e.g. SL0360A3"
          onUse={(v) => {
            const hit = matchParts(v).find((p) => parts.includes(p));
            if (hit) set({ part: hit.name, psu: undefined, currentA: undefined }); else setMiss(v);
          }} />
      </>
    );
  } else if (needsPsu && !psu && picked.psu !== NO_SUPPLY) {
    const supplies = parts.filter((p) => p.kind === 'supply').sort((a, b) => rank('supply')(a.name, b.name));
    body = (
      <>
        <div className="q-ask">On which supply?</div>
        <div className="q-why">A DC/DC driver gets its voltage and its watt cap from the supply.</div>
        <div className="q-opts">
          {supplies.map((p, n) => (
            <Opt key={p.name} label={p.name} top={n === 0 && prec.supply[p.name]} part={p}
              sub={`${fmt(p.outputV) ?? '-'}V · ${fmt(p.maxPowerW) ?? '-'}W`} tag={used(prec.supply[p.name])}
              onClick={() => set({ psu: p.name })} />
          ))}
          <Opt label="None" sub="supplied elsewhere" onClick={() => set({ psu: NO_SUPPLY })} />
        </div>
        <Other placeholder="Supply name, e.g. HLG-185-24"
          onUse={(v) => {
            const hit = matchParts(v).find((p) => p.kind === 'supply' && parts.includes(p));
            if (hit) set({ psu: hit.name }); else setMiss(v);
          }} />
      </>
    );
  } else if (needsCurrent && !(Number(currentMa) > 0)) {
    const inRange = (ma) => spec.minA == null || (ma >= spec.minA * 1000 && ma <= spec.maxA * 1000);
    const here = Object.keys(prec.currentA).map((a) => Math.round(a * 1000)).filter(inRange);
    const mas = [...new Set([...here.sort((a, b) => (prec.currentA[b / 1000] ?? 0) - (prec.currentA[a / 1000] ?? 0)),
      ...COMMON_MA.filter(inRange)])];
    body = (
      <>
        <div className="q-ask">Driven at what current?</div>
        <div className="q-why">
          The {part.name} runs at {spec.minA * 1000}–{spec.maxA * 1000}mA. Neither the Ref nor the Name says which.
        </div>
        <div className="q-opts">
          {mas.map((ma, n) => (
            <Opt key={ma} label={`${ma} mA`} top={n === 0 && here.includes(ma)}
              tag={used(prec.currentA[ma / 1000])} onClick={() => set({ currentA: String(ma) })} />
          ))}
        </div>
        <Other placeholder="mA, e.g. 525" type="number" onUse={(v) => set({ currentA: v })} />
      </>
    );
  }

  return (
    <>
      {crumbs.length > 0 && (
        <div className="q-crumbs">
          {crumbs.map((c) => (
            <button key={c.k} type="button" className="q-crumb" title="Change this" onClick={c.go}>
              {c.label}{c.from === 'suggestion'
                ? <em className="q-sug"><span className="material-icons">auto_awesome</span>suggested</em>
                : c.from && <em>from the {c.from}</em>}
            </button>
          ))}
        </div>
      )}
      {body}
    </>
  );
}
