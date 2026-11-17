# Open DAT reports: fix plan (2026-11-17)

These are the four open reports from `psr_reports(tool='dat')`. Two are already fixed and live. The other
two need code.

## 1. EECDB2: crash on a cable that feeds two position types (needs code)

**What happens.** On project 3059, set 110084, hub LGC/P5003, `parseLinks` throws
`duplicate LinkRef: _GENERATIVE-X500427` and the landing screen goes down.

**Why.** LinkList (DJ 101585) gives one row per LinkRef × location × position type.
`LinkSumPower(W)` and `Vf` are summed over *that row's* LinksMap rows only, because `#LinkDataRaw`
is keyed by `(Ref, LinkRefRowKey)`, which means one row per destination. So the rows for one LinkRef
are the parts of one cable:

| set | LinkRef | rows | the cable is |
|---|---|---|---|
| 110084 | _GENERATIVE-X500427 | B2b 3W / 8.6Vf, B2c 9W / 25.8Vf, both Playroom, CC 0.35A | 12W / 34.4Vf |
| 109833 | _GENERATIVE-X500641 | A1 4.5W / 6.4Vf in 2F WC, A1 4.5W / 6.4Vf in Primary Ensuite | 9W / 12.8Vf |

LinkPowerFlow's own `#EntityLoads` totals a link the same way: it groups `#LinkDataRaw` by Ref.

**A second bug in the same code.** The room merge from 9b0b929 keeps the *first* row's power.
X500641 therefore loads as 4.5W / 6.4Vf when it is really 9W / 12.8Vf, which is half its load.
Validation passes a cable that may be overloaded, and nothing is shown to the user. Two rooms with
the same fitting is common, so other hubs are affected too.

**Fix, all in `parseLinks` (`src/engine.js:248`).**
- Rows that share a LinkRef make up one cable:
  - `loadW` is the sum of the rows.
  - `fvV` is the sum of the rows for CC (fittings in series).
  - `location` is the distinct values, joined with `; `.
  - `positionType` is the distinct values, joined with `, `.
  - `threadCount` and `controlType` are also joined from their distinct values.
- A blank value is "not stated" and is not a clash. For example, 109833 X50038 has one row with an
  empty SecondaryPowerType and one with CV, and that should merge as CV.
- These columns are still a real clash if they disagree: PullZone, LinkTypeRef, SecondaryPowerType,
  LinkCurrent (CC), LinkVoltage(V) (CV) and ControlType.
- For a clash, **don't throw** (decided by Erik, 2026-11-17). Load the link with `clash: [cols]` and have
  `validate()` raise an ERROR on it, so the rest of the hub still opens. The alternative is to keep
  throwing, which is today's behaviour: one bad cable blocks the whole hub. The error message must
  still name only the columns, never the values, because the message goes out in crash reports.
- Tests (`test/engine.test.mjs:1072`):
  - Rewrite the room test so two rows of 4.5W give 9W / 12.8Vf.
  - Add the EECDB2 rows: they should give 12W / 34.4Vf, `B2b, B2c`, and no throw.
  - Add a blank versus stated SecondaryPowerType case that merges.
  - Add a case where LinkCurrent differs: the hub should load and that link should carry an ERROR.
- Update `EMBEDDING.md` §Links Assignment CSV to say that one LinkRef can come as several rows and
  the tool sums them.

## 2. CBEK3X: blank ControlType not flagged (needs code)

**What happens.** On the Types screen (3059, hub 4FA), a driver type with no ControlType shows no
fault.

**Why.** `faults()` (`src/typeFaults.js:22`) checks MaxPower, CC/CV, CurrentRange and OutputVoltage,
but never ControlType. Sizing needs a ControlType on both sides (`controlTypeOk`,
`src/engine.js:1016`). A type left blank therefore silently matches no cable and drops out of sizing.

**Fix.**
- In `faults()`, add `if (!t.controlType) out.push(['no ControlType - matches no cable', 'With no
  ControlType this driver matches no cable, so it is left out of sizing.'])`.
- The setup questions already ask for ControlType (`QUESTIONS`), so the existing fill flow is the
  fix the user is offered.
- Add one test: a type that is complete apart from ControlType has exactly that fault.
- Check that the type-library fallback, where a hub row is blank but the library has a value, fills
  `controlType` before `faults()` runs. Otherwise the new fault would be flagged wrongly.

## 3. XE8PNC: tunable fitting not flagged (already fixed, resolve)

The fix is #58 / f32eb23 (overlay V1.15). Before it, the embedded assessment didn't send the channel
columns. DJ 101681 is now V1.15 rev 102, and drivers.erikrees.co.uk serves f32eb23 ("Scarlet
Lemur"). To confirm, reopen hub 4FA on 3059: R6 (B5, L140-L-02) should show Tunable.

## 4. 9GYN2L: "does not work" in What to check (already fixed, resolve)

This was sent from dev build cdc4bef (#51) at 18:46 on 2026-11-04. #53 and #54 fixed it, cite it by
id, and have been on main since 2026-11-05.

## Order

1. Resolve 3 and 4 in datajoin (`psr_reports` resolve, with a note citing the fix).
2. Make one PR to `dev` with fixes 1 and 2. Then a "Ship" PR to `main`. Then resolve EECDB2 and
   CBEK3X once the fixes are live.
