# Driver families: identify the product, judge the data, ask only about the gaps — plan

Started 2026-11-04 on branch `driver-questions`. Progress is the checklist in §9; STATE.md points
here while this is open.

## 0. Why

The questions flow and the companion surfaces in it (#50 and the unmerged `driver-questions` work)
are a job half done. Each of these is a symptom of one cause: the companion was built as its own
workflow — suggest, check, vote — and bolted onto every screen.

- **"Suggest a catalogue part"** asks the person to do the companion's job. The tool should notice
  for itself that they are using something new.
- **"To check"** gives them homework. A suggestion that needs confirming should come up only when
  it is the thing being decided, and a real error should look like an error.
- **"Suggest a correction to X"** reads as correcting their own data, not the suggestion.
- **"N of these need no questions · Fill in all"** forces them either to trust it blindly or to go
  through every type one at a time.

## 1. Principle

The person's job is to get the type's attributes right. The companion is an **effortless aide**:

- It never asks for effort the task doesn't already need. Accepting values is one click whether or
  not they came from a suggestion, so accepting one costs nothing extra.
- It speaks only when that changes what the person does. Silent on agreement, a source mark on a
  filled gap, a plain error on a conflict.
- It spends the person's attention only where there is doubt.
- When it isn't there (Pages), nothing is missing: the flow is the same, minus the extra values.

Order of work, always: **identify the product → judge their data against it → ask only about the
gaps.** About 90% of the time a project uses the same few products, so once the product is known
that is the whole job.

## 2. Identify

One pure function, `identify(types, parts)` in `src/typeFaults.js`, with no React, tested like
the rest of that file. For each type it gives `{ part, supply, confidence, evidence, rivals }`.

The signals, most telling first:

| Signal | Already exists |
|---|---|
| The Name's model token | `matchParts` |
| The Ref's pattern: CCR/CVR, `-700-`, `1CH`/`2CH`, `EM` | `currentFromRef`, `known` |
| PowerType, ControlType, outputs stated in the DesignDB | `known` |
| The values already filled in (MaxPower, current, fV) | `faults` |
| What the project's other types resolved to | `precedent` |
| Agreed shared parts | `allParts`, `checkOf` |

- **Confident**: one part, with no rival scoring close. It joins that family.
- **Close call**: two or more parts. It joins the likeliest family, marked as a guess; its rivals are kept for the review.
- **Nothing**: it goes to the review at the end, and from there to the questions.

The evidence is kept so the card can say *why* in a hover ("the Name says SOLODrive 360/A; the Ref
says CC, 1 output").

## 3. Judge

For every column the type writes, compare the DesignDB's value with the part's:

| Status | When | Shown |
|---|---|---|
| `same` | it agrees | nothing |
| `fill` | the DesignDB is blank | the value, with its source |
| `differs` | it disagrees, but within reason (e.g. a derating) | an amber mark on the branch |
| `wrong` | the stated value is impossible for this part (185 W on a 30 W driver; current out of range) | a red mark, which must be answered |

This builds on `faults()`, which already makes the `disagrees` call. The new part is splitting it
into `differs` and `wrong`.

## 4. When they disagree

Disagreeing never happens in the middle of a family. On a type the person clicks **Not right**, and
the type is set aside to a review at the end, its curve dashed. The family's own question goes on
without it.

At the review, each type that was set aside asks what's wrong, with one click each and no free text:

| Answer | What it does |
|---|---|
| It's a different product | re-identifies it with that part excluded: another family, or the questions |
| It is this product, but its own values are right | keeps the DesignDB's values; records which ones differ, plus a reason (below) |
| Put it back | returns it to the family, taking the datasheet's values |

"Its own values are right" asks once more, per differing value: *derated on purpose* (only when its
value is lower), *a different variant*, or *the datasheet's wrong*. That answer is the knowledge
gathered. It travels as a code, never as text, because of the hard constraint (§8).

## 5. Families, one at a time

The Driver attributes dialog walks through **one product family per step**, biggest first, then
finishes with a review. Steps show as pills across the top ("SoloDrive 360/A · 6", …, "Review").

Each step asks one question, **"Are these 6 a SoloDrive 360/A?"**, with a line saying where
values differ, the datasheet's will be used.

- **The product** sits on the left: the name, its source (the Kaizen spec page, or *from another
  project*), and its datasheet values.
- **Curved lines** run from the product to each type card on the right. A type set aside gets a
  dashed grey curve.
- **A type card** leads with what differs from its siblings (the current, an EMERGENCY tag), then
  the Ref and the Name, then exactly what will be written:
  - *Already agrees* (green)
  - *Fills in Current 1.05 A, from the Ref* (blue)
  - *Max power: ~~185 W~~ → 30 W · 185 W is the HLG-185-24 supply's rating* (red)
  - *A guess from the Ref and this project's other drivers* (amber), for a type with no Name
- **One button per step**: "Yes, all 6 are SoloDrive 360/A →", which becomes "Yes, these 5 are…"
  once one is set aside.
- A close call (§2) appears in the family it most likely belongs to, with the amber guess line.
  Not right sends it to the review, where "It's a different product" moves it.
- The current is already settled by the Ref and the Name (`currentOptions`). When those disagree,
  the card shows both and asks which, as today.

**The review** comes last and lists the types that were set aside (§4) and those with no product
found. Each type with no product gets "Answer a few questions" (the existing `Questions` flow in
`SetupWizard.jsx`), with "Fill it in by hand" as the last resort.

## 6. What it replaces

These go:

- The `sw-all` banner ("N of these need no questions", "Fill in all"). The families are this.
- `SharePart` in `PresetEditor.jsx` (both "Suggest a correction to X…" and "Suggest a catalogue part…").
- The `SharedCheck` card in the wizard, and the "to check" tags on the part buttons, the supply
  buttons and New type.

`SharedCheck` stays on the Types page card only if a §7 confirmation can't reach a type any other
way. Decide in phase 3. (2026-11-04: it went. An unchecked correction is asked about per value in
the family step and the type editor, `src/components/Disputes.jsx`.)

## 7. The companion, hidden

The companion is never visible unless it needs the person's input. There is no opt-in, no sharing
setting, no sparkle on parts and no "suggested" badge. The only trace of it is that a family's
source reads *from another project* rather than the spec page.

It reuses the endpoint that already exists (`/companion/parts`: `{part}` and `{vote}`). The only
server change is the reason code: `{reason}`, alone or as `{part, reason}`.

| The person does | Sent |
|---|---|
| Says yes to a family built on a shared part | `{vote: yes}` for that part's `rev` |
| Says yes to a family built on a spec page | nothing |
| Answers "its own values are right" | `{reason}`: a code per differing value (derated, variant, datasheet); with `{part}`, the amendment, only for values the datasheet has wrong |
| Fills in a type by hand that matches no part | `{part}`: a new observation, built by `partFromDraft` |
| Answers "it's a different product" on a shared part | `{vote: no}` |
| Picks between the datasheet and another project's unchecked correction (family step, type editor) | `{vote}`: theirs `confirmed`, the datasheet's `rejected`, not sure `unsure`; any datasheet pick on a part makes it `rejected` |

**A part only one other person has entered** still forms a family. Saying yes to it is the second
vote. There is no separate check.

## 8. Hard constraint 🛑

CLAUDE.md says only what the person **chooses** to send leaves the browser, naming a report, a
shared part and a Yes/No/Not sure check. §7 sends because of the person's answers, with no send
button and no opt-in (Erik, 2026-11-04: the companion stays hidden unless it needs input). The
proposed wording:

> …only what the person's answers produce leaves the browser: a bug report built from allowlists
> in `remoteReport()`, and, while filling in driver types, the part they settled on
> (`partFromDraft`), a reason code when they keep their own values, and a vote when they use
> another project's part.

The rest still holds: never a CSV, the session, or free text.

## 9. Phases

- [x] 1. This plan.
- [x] 2. Mock it in Playwright against the demo's real types. Erik chose the second version
  (one family at a time, curved lines) with its own styling, the Refs as the SP assessment's
  `est-pill est-pill-type` pills, and no source line (2026-11-04).
- [x] 3. `identify()`, `familyPreset()` and `judge()` (`fill`/`differs`/`wrong`; `same` is left
  out), tested in `typeFaults.test.mjs`. 4746's cases are in the test.
- [x] 4. The family steps, in `src/components/Families.jsx`, driven by `SetupWizard.jsx`. `sw-all`
  and the pip rail are gone.
- [x] 5. The review: set aside, the three §4 answers, and the groups with no product found. A
  group is asked about once and the answer written to each, at its own current. The per-value
  reason came with phase 6.
- [x] 6. Implicit companion: the votes, amendments, reason codes and observations from §7, in
  `src/learn.js` (2026-11-04). The removals: SharePart, SharedCheck in the wizard, and the tags.
- [x] 7. The reason code on the server: datajoin `/gateway/dat/parts` stores it in
  `dat_part_reasons` (branch `dat-part-reasons`). dat_bridge relays the body unchanged.
- [x] 8. Retake `docs/companion-shots.mjs` and rewrite the "Filling in a driver type" section of
  `docs/companion.md` (the current shots show the surfaces this removes). Update CLAUDE.md, the
  hard constraint and the gotchas.

## 9a. Tried against project 4746 (2026-11-04)

Its six live lighting sets carry driver types that are blank apart from `Parameters` and
`BallastCountPerUoM`. That is the main case this plan is for, since nearly every column is a fill.

- **Families form cleanly from the Name.** Examples: DualDrive 560/A at 350/500/700/1050 mA,
  SOLOdrive 240/A ×4, and LIN 200D-D2Z2C "LightShape Variant 1–8". Today's `resolveSpec` finds
  these.
- **Families exist with no part in the catalogue:**
  - TCI MP 32 HV K2 ×3
  - POWERdrive 50SA-M4Z0X ×3
  - PowerLED PCC35020/PCC70020
  - PCV12200E/PCV24200E

  So `identify` must also group by the Name with its current stripped out. A family with no
  datasheet gets the questions **once**, and the answers apply to all its types. Without this,
  most of 4746 falls into the review one type at a time.
- `ET-CCR-D-*-2CH-01` is named "SOLOdrive 560/A", and its Parameters give 2 outputs. That
  agrees with the catalogue, which lists the 560/A with 2. Where the two disagree, the
  Parameters' output count sends the type to the review.
- **A wrong match.** "HLG-185H-24A & LTEC LT-995-OLED DMX Decoder" resolves to the HLG supply
  alone. A Name with an unknown second product is not a match.
- **Not drivers:** `ET-DALI-RELAY` (a Helvar relay) and `ET-DALI-PHASE-CONVERTER` pass the
  overlay's `<OP.` filter. They belong in the review, not in a family.
- Ref patterns vary between branches of one project (`ET-DALI-CCR-SC-350` vs `ET-CCR-D-350-1CH-01`),
  and `currentFromRef` misses the first. The Name gives the current, so this is fine.

## 10. Open decisions 🛑

1. ~~The §8 wording.~~ Agreed (2026-11-04); it is the CLAUDE.md hard constraint.
2. Where a value that "differs" ends and one that is "wrong" begins. The proposal: "wrong" when the
   value is beyond what the part can do at all (power above its max, current out of range), and
   "differs" otherwise. Both now take the datasheet's value unless the type is set aside, so this
   only decides the colour and the hint.

