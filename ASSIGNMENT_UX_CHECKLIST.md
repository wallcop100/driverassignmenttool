# Assignment UX — streamline & noise reduction

Goal: make the UI *decide-support*, not just record. Surface the constraints that
actually rule placements in/out (CC/CV, current/voltage rating, ControlGroup) and
quiet the constraints that don't. Derived from the brainstorm on 2026-07-06.

Insight from the data: for this dataset the real decision is "same ControlGroup +
fits the watts". CC/CV is a trivial eyeball; CV voltage is a no-op (all 24V); CC
current is unpopulated (derived). So ControlGroup + capacity do the narrowing.

## Backend
- [x] `fingerprint_compatible(link, driver)` — fill-independent rule-out (CC/CV, CC current ±15%, CV voltage). `validation.py`
- [x] `POST /eligibility {zone, assignments, addedDrivers}` → `{nodesByLink, impossibleByLink}` — one call powers #1/#3/#4/#7. `main.py`, `validation.py`

## Frontend features
1. [x] **Dim the impossible** — on link-select, grey/shrink fingerprint-incompatible drivers; distinguish *impossible* (wrong type) vs *full* (right type, no room) vs *candidate* (has an eligible node). `DriverBin.jsx`
2. [x] **ControlGroup as tray spine** — group/sort tray by ControlGroup; "place group" drops a whole group onto one chosen node. `Tray.jsx`, `state.js` (PLACE_GROUP)
3. [x] **Fill this node** — click an empty/partial node (no link selected) → tray filters to links eligible for it. `ZonePage.jsx`, `Tray.jsx`, `DriverBin.jsx`
4. [x] **Target count + forced moves** — per-tray-link badge of eligible node count; 0 = orphan (needs driver), 1 = forced (do first). `Tray.jsx`
5. [x] **Actionable vs expected warnings** — split FAIL/MISMATCH (actionable) from WARN (info); collapse info by default, de-emphasize styling, separate counts. `ZonePage.jsx`, `Landing.jsx`, `Block.jsx`
6. [x] **Mains/provision links out of the way** — LV-PROV / N/A (no powerType) links into a collapsible provision lane, hidden from the normal tray. `Tray.jsx`
7. [x] **Suggest a driver to add** — cluster orphan links by fingerprint, recommend the matching inventory type, one-click add. `ZonePage.jsx`

## Verify
- [x] pytest green (add eligibility/fingerprint tests)
- [x] live app: select a link → only candidates lit; group-place; fill-node; orphan banner adds correct driver; warnings collapsed by default
