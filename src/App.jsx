import { useEffect, useReducer } from 'react';
import * as api from './api.js';
import ImportScreen from './components/ImportScreen.jsx';
import Landing from './components/Landing.jsx';
import ZonePage from './components/ZonePage.jsx';
import { initialState, reducer } from './state.js';

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { model, assignments, addedDrivers, selectedLink } = state;

  useEffect(() => {
    if (!model) return;
    let stale = false;
    api.validate(assignments, addedDrivers)
      .then((r) => !stale && dispatch({ type: 'SET_FLAGS', flags: r.flags }))
      .catch(console.error);
    return () => { stale = true; };
  }, [model, assignments, addedDrivers]);

  useEffect(() => {
    if (!model || !selectedLink) return;
    let stale = false;
    api.suggest(selectedLink, assignments, addedDrivers)
      .then((r) => !stale && dispatch({
        type: 'SET_SUGGESTIONS',
        suggestions: new Set(r.targets.map((t) => `${t.driver}|${t.node}`)),
      }))
      .catch(console.error);
    return () => { stale = true; };
  }, [model, selectedLink]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') dispatch({ type: 'SELECT_LINK', linkRef: null });
      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ type: 'UNDO' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!model) return <ImportScreen dispatch={dispatch} />;
  if (state.view.page === 'zone') return <ZonePage state={state} dispatch={dispatch} zone={state.view.zone} />;
  return <Landing state={state} dispatch={dispatch} />;
}
