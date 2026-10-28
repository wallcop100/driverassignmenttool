import { useMemo } from 'react';
import { bannedNodes, driverTypes, filledHere, needsSetup, resolveSpec, statedAttributes } from '../engine.js';
import { disagreeing } from '../typeFaults.js';

// Said on every surface you can land on, because which one that is depends on
// how you arrived: the host opens a hub, so embedded you land on ZonePage and
// never see the landing page at all. Until the driver types state something,
// nothing on any hub can be sized or checked, so it is not a notice to go
// looking for.
//
// Project wide, not per hub: the host sends the whole library, a driver type
// belongs to the job rather than to the hub that happens to be open, and filling
// one in should settle it everywhere it is used. Control gear is left out - it
// has none of these attributes and never will.
export default function SetupNotice({ state, dispatch, className = '' }) {
  const { model } = state;
  const inUse = useMemo(() => driverTypes(model), [model]);
  const onboarding = useMemo(() => needsSetup(model), [model]);
  const banned = useMemo(() => bannedNodes(model), [model]);
  const partly = !onboarding && inUse.length > 0
    && inUse.filter((t) => statedAttributes(t) === 0).length;
  // A type already filled in can still be wrong: one the datasheet, or a part two
  // people have checked, disagrees with is worth flagging before anyone sizes on it.
  const wrong = useMemo(() => disagreeing(inUse, resolveSpec), [inUse]);
  const pending = filledHere(model, state.presets);
  const pendingNote = pending > 0
    && <div className="small">{pending} filled in here, waiting on the patch to reach the DesignDB.</div>;

  if (!onboarding && !banned.length && !partly && !wrong.length) return null;
  const go = () => dispatch({ type: 'SET_VIEW', view: { page: 'types', back: state.view } });

  if (onboarding) {
    return (
      <div className={`dp-suggest sw-offer ${className}`}>
        <div>
          <b>
            None of this project’s {inUse.length} driver type{inUse.length === 1 ? '' : 's'} have their attributes filled in the DesignDB
          </b>
          {pendingNote}
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

  if (!partly) {
    return (
      <div className={`dp-suggest sw-offer is-part ${className}`}>
        <div>
          <b>{wrong.length} driver type{wrong.length === 1 ? '' : 's'} disagree with the datasheet</b>
          <div className="text-secondary small">
            {wrong.slice(0, 4).map((t) => t.typeRef).join(' · ')}{wrong.length > 4 ? ` +${wrong.length - 4}` : ''}.
            {' '}Sizing trusts what the DesignDB states, so check which is right.
          </div>
        </div>
        <button className="btn btn-sm btn-outline-primary ms-auto" onClick={go}>Check them</button>
      </div>
    );
  }

  return (
    <div className={`dp-suggest sw-offer is-part ${className}`}>
      <div>
        <b>{partly} of the project’s {inUse.length} driver types still have no attributes filled in</b>
        {pendingNote}
        <div className="text-secondary small">Patch what you have, or carry on through the rest.</div>
      </div>
      <button className="btn btn-sm btn-outline-primary ms-auto" onClick={go}>Carry on</button>
    </div>
  );
}
