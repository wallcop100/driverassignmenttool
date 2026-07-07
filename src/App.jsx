import { useEffect, useReducer, useState } from 'react';
import * as api from './api.js';
import ImportScreen from './components/ImportScreen.jsx';
import Landing from './components/Landing.jsx';
import Tutorial from './components/Tutorial.jsx';
import ZonePage from './components/ZonePage.jsx';
import { LabelContext } from './labelContext.js';
import { clearSession, loadSession, saveSession } from './persist.js';
import { initialState, intersectionSuggestions, reducer } from './state.js';

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { model, assignments, addedDrivers, selectedLinks } = state;
  const [saved] = useState(loadSession); // a prior session, offered on the import screen

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

  // autosave the whole session (#3)
  useEffect(() => { saveSession(state); }, [model, assignments, addedDrivers, state.prefs, state.view]);

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
  if (!model) {
    screen = (
      <ImportScreen dispatch={dispatch} saved={saved}
        onResume={() => dispatch({ type: 'RESTORE', saved })}
        onDiscard={clearSession} />
    );
  } else if (state.view.page === 'zone') {
    screen = <ZonePage state={state} dispatch={dispatch} zone={state.view.zone} />;
  } else {
    screen = <Landing state={state} dispatch={dispatch} />;
  }
  return (
    <LabelContext.Provider value={state.prefs.label}>
      {screen}
      {state.demo && model && <Tutorial dispatch={dispatch} view={state.view} />}
    </LabelContext.Provider>
  );
}
