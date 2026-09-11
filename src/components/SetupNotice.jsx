import { useMemo } from 'react';
import { bannedNodes, needsSetup, statedAttributes } from '../engine.js';

// Said on every surface you can land on, because which one that is depends on
// how you arrived: the host opens a hub, so embedded you land on ZonePage and
// never see the landing page at all. Until the driver types state something,
// nothing on any hub can be sized or checked, so it is not a notice to go
// looking for.
//
// Judged on the types the job actually places — a library of parts nobody has
// used is not what needs filling in.
export default function SetupNotice({ state, dispatch, className = '' }) {
  const { model } = state;
  const inUse = useMemo(
    () => model.inventory.filter((t) => model.drivers.some((d) => d.typeRef === t.typeRef)),
    [model.inventory, model.drivers],
  );
  const onboarding = useMemo(() => needsSetup({ inventory: inUse }), [inUse]);
  const banned = useMemo(() => bannedNodes(model), [model]);
  const partly = !onboarding && inUse.length > 0
    && inUse.filter((t) => statedAttributes(t) === 0).length;

  if (!onboarding && !banned.length && !partly) return null;
  const go = () => dispatch({ type: 'SET_VIEW', view: { page: 'types' } });

  if (onboarding) {
    return (
      <div className={`dp-suggest sw-offer ${className}`}>
        <div>
          <b>
            {inUse.length} driver type{inUse.length === 1 ? '' : 's'} here have no attributes filled in
          </b>
          <div className="text-secondary small">
            Watts, current and forward voltage live on ElementTypes. Until they are
            there every driver reads as undetermined and nothing is checked. Most
            fill in from their datasheet in one press.
          </div>
        </div>
        <button className="btn btn-sm btn-primary ms-auto" onClick={go}>Fill them in</button>
      </div>
    );
  }

  if (banned.length) {
    return (
      <div className={`dp-suggest sw-offer is-banned ${className}`}>
        <div>
          <b>{banned.length} driver type{banned.length === 1 ? '' : 's'} use a colon in a node name</b>
          <div className="text-secondary small">
            {banned.flatMap((b) => b.nodes.map((n) => `${n.from} → ${n.to}`)).join(' · ')}.
            {' '}The colon is spoken for elsewhere in Parameters syntax.
          </div>
        </div>
        <button className="btn btn-sm btn-primary ms-auto" onClick={go}>Correct them</button>
      </div>
    );
  }

  return (
    <div className={`dp-suggest sw-offer is-part ${className}`}>
      <div>
        <b>{partly} of {inUse.length} driver types here still have nothing filled in</b>
        <div className="text-secondary small">Patch what you have, or carry on through the rest.</div>
      </div>
      <button className="btn btn-sm btn-outline-primary ms-auto" onClick={go}>Carry on</button>
    </div>
  );
}
