import { useEffect, useReducer, useRef, useState } from 'react';
import * as api from './api.js';
import ImportScreen from './components/ImportScreen.jsx';
import Landing from './components/Landing.jsx';
import ResumeBanner from './components/ResumeBanner.jsx';
import Tutorial from './components/Tutorial.jsx';
import ZonePage from './components/ZonePage.jsx';
import * as embed from './embed.js';
import { LabelContext } from './labelContext.js';
import { clearSession, loadSession, saveSession, setSessionKey } from './persist.js';
import { diffRows, initialState, intersectionSuggestions, reducer } from './state.js';

const embedded = embed.isEmbedded();

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { model, assignments, addedDrivers, selectedLinks } = state;
  // standalone reads the session at mount; embedded the key isn't known until
  // dat:init lands, so the init handler re-reads it under the right key.
  const [saved, setSaved] = useState(() => (embedded ? null : loadSession()));
  const [notice, setNotice] = useState(null);
  const [fatal, setFatal] = useState(null);

  // Embedded, the host opened this frame on one specific hub and the modal
  // around us is hub-specific — so stay put. Only follow the saved view if the
  // restored model actually still has that zone.
  const resume = () => {
    const pin = embedded && state.view.page === 'zone'
      && saved.model?.zones?.includes(state.view.zone) ? state.view : undefined;
    dispatch({ type: 'RESTORE', saved, view: pin });
    setSaved(null);
  };
  const discard = () => { clearSession(); setSaved(null); };

  // the message handler below is mounted once, so it can't close over `model`
  const hasModel = useRef(false);
  hasModel.current = !!model;

  // Embed mode: the host posts both CSVs in over postMessage. Announce readiness
  // only after mount — iframe.onload fires well before React is listening.
  useEffect(() => {
    if (!embedded) return;
    const off = embed.onInit((msg, error) => {
      if (error) { if (hasModel.current) setNotice(error); else setFatal(error); return; }
      try {
        const model = api.parseText(msg.form, msg.links);
        const focus = msg.focusZone;
        // No match is a legitimate state — a hub with no drivers yet is exactly
        // what this tool exists to fix. Land on the list with a notice instead.
        const matched = focus && model.zones.includes(focus);
        if (focus && !matched) setNotice(`${focus} isn't in the data the host sent — showing everything it did send.`);
        setSessionKey(msg.context?.systemSetId, msg.context?.hubRef);
        setSaved(loadSession());
        dispatch({
          type: 'INIT',
          model,
          context: msg.context ?? null,
          view: matched ? { page: 'zone', zone: focus } : undefined,
        });
      } catch (e) {
        // a bad re-init when we already have working data is a notice, not a
        // wipe — don't take the user's zone away from them
        if (hasModel.current) setNotice(e.message); else setFatal(e.message);
        embed.sendError(e.message);
      }
    });
    embed.sendReady();
    return off;
  }, []);

  useEffect(() => {
    if (!model) return;
    let stale = false;
    api.validate(assignments, addedDrivers)
      .then((r) => !stale && dispatch({ type: 'SET_FLAGS', flags: r.flags }))
      .catch(console.error);
    return () => { stale = true; };
  }, [model, assignments, addedDrivers]);

  // One eligibility fetch per zone/state change powers dim-the-impossible,
  // fill-node, target counts and orphan detection.
  const zone = state.view.page === 'zone' ? state.view.zone : null;
  useEffect(() => {
    if (!model || !zone) return;
    let stale = false;
    api.eligibility(zone, assignments, addedDrivers)
      .then((r) => !stale && dispatch({ type: 'SET_ELIGIBILITY', eligibility: r }))
      .catch(console.error);
    return () => { stale = true; };
  }, [model, zone, assignments, addedDrivers]);

  // best-fit green nodes = intersection of the selection's eligible nodes
  useEffect(() => {
    if (!selectedLinks.length || !state.eligibility) return;
    dispatch({ type: 'SET_SUGGESTIONS', suggestions: intersectionSuggestions(selectedLinks, state.eligibility) });
  }, [selectedLinks, state.eligibility]);

  // autosave the whole session (#3) — this already observes every mutation, so
  // it is also where the host gets told the change count (no reducer side effects).
  //
  // Embedded, while a resume offer is unanswered, we must NOT save: the host's
  // fresh model has already loaded underneath the banner, and writing it would
  // overwrite the very session being offered — two flaky reloads would then
  // silently destroy the user's work. Answering it either way clears `saved`
  // and autosave takes over. (Standalone the offer only exists on the import
  // screen, where there is no model to save, so nothing changes there.)
  useEffect(() => {
    if (embedded && saved) return;
    saveSession(state);
    if (embedded && model) embed.send({ type: 'dat:dirty', changeCount: diffRows(state).length });
  }, [model, assignments, addedDrivers, state.prefs, state.view, saved]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') dispatch({ type: 'SELECT_LINKS', linkRef: null, additive: false });
      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'REDO' : 'UNDO' });
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); dispatch({ type: 'REDO' }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  let screen;
  if (!model && embedded) {
    // A silent blank iframe is the worst failure mode — it looks identical to a
    // broken host. Always say which of the two we are.
    screen = (
      <div className="container d-flex justify-content-center align-items-center min-vh-100">
        <div className={`alert ${fatal ? 'alert-danger' : 'alert-secondary'} text-center mb-0`}>
          {fatal ?? 'Waiting for the host to send this hub’s data…'}
        </div>
      </div>
    );
  } else if (!model) {
    screen = <ImportScreen dispatch={dispatch} saved={saved} onResume={resume} onDiscard={discard} />;
  } else if (state.view.page === 'zone') {
    screen = <ZonePage state={state} dispatch={dispatch} zone={state.view.zone} />;
  } else {
    screen = <Landing state={state} dispatch={dispatch} />;
  }
  return (
    <LabelContext.Provider value={state.prefs.label}>
      <div className="app-shell">
      {embedded && model && <ResumeBanner saved={saved} onResume={resume} onDiscard={discard} />}
      {notice && (
        <div className="alert alert-warning d-flex align-items-center gap-2 py-2 mb-0">
          <span className="material-icons">info</span>
          <div className="flex-grow-1 small">{notice}</div>
          <button className="btn-close" onClick={() => setNotice(null)} />
        </div>
      )}
      {screen}
      </div>
      {state.demo && model && <Tutorial dispatch={dispatch} view={state.view} />}
    </LabelContext.Provider>
  );
}
