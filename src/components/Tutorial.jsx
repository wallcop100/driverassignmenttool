import { useEffect, useState } from 'react';

// Each step can navigate (view) and spotlight an element (target, by data-tour).
const STEPS = [
  { title: 'Welcome to the demo', target: '[data-tour="zones"]', view: { page: 'landing' },
    body: 'Sample data is loaded. Bars show assignment completion; sort to triage, or search any ref. Let’s pack a zone.' },
  { title: 'Open a pullzone', target: '[data-tour="tray"]', view: { page: 'zone', zone: 'HUB-A' },
    body: 'HUB-A is left completely unassigned to practise on. Its cables wait in the tray on the left, grouped by ControlGroup.' },
  { title: 'The tray', target: '[data-tour="tray"]', view: { page: 'zone', zone: 'HUB-A' },
    body: 'Expand a group and click a cable — valid driver nodes light up green and incompatible drivers dim. Drag or click a node to place. Ctrl/⌘-click for several at once.' },
  { title: 'Drivers', target: '[data-tour="grid"]', view: { page: 'zone', zone: 'HUB-A' },
    body: 'Each driver shows its total capacity and per-node bars. Red means over/mismatch; info warnings stay collapsed.' },
  { title: 'Review & export', target: '[data-tour="review"]', view: { page: 'zone', zone: 'HUB-A' },
    body: 'When you’re happy, Review shows the diff and exports an updated CSV. Undo/redo anytime. That’s it — have a play!' },
];

export default function Tutorial({ dispatch, view }) {
  const [step, setStep] = useState(0);
  const [closed, setClosed] = useState(false);
  const s = STEPS[step];

  // navigate to the step's page, then pulse its target once the DOM settles
  useEffect(() => {
    if (closed || !s) return undefined;
    const sameView = view && s.view.page === view.page && s.view.zone === view.zone;
    if (!sameView) dispatch({ type: 'SET_VIEW', view: s.view });
    let el;
    const t = setTimeout(() => {
      el = document.querySelector(s.target);
      el?.classList.add('tour-pulse');
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 160);
    return () => {
      clearTimeout(t);
      document.querySelectorAll('.tour-pulse').forEach((e) => e.classList.remove('tour-pulse'));
    };
  }, [step, closed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (closed || !s) return null;
  const last = step === STEPS.length - 1;

  return (
    <div className="tutorial-card">
      <div className="tutorial-head">
        <span className="badge text-bg-primary">Demo tutorial</span>
        <span className="text-secondary small ms-auto">{step + 1} / {STEPS.length}</span>
        <button className="btn-close btn-close-sm ms-2" onClick={() => setClosed(true)} />
      </div>
      <div className="tutorial-title">{s.title}</div>
      <p className="tutorial-body">{s.body}</p>
      <div className="tutorial-foot">
        <button className="btn btn-sm btn-link text-secondary p-0" onClick={() => setClosed(true)}>Skip</button>
        <div className="ms-auto d-flex gap-2">
          {step > 0 && <button className="btn btn-sm btn-outline-secondary" onClick={() => setStep(step - 1)}>Back</button>}
          {last
            ? <button className="btn btn-sm btn-primary" onClick={() => setClosed(true)}>Got it</button>
            : <button className="btn btn-sm btn-primary" onClick={() => setStep(step + 1)}>Next</button>}
        </div>
      </div>
    </div>
  );
}
