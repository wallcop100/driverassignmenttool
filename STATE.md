# driverassignmenttool — state

Updated: 2026-11-03

<!-- Now / Next / Blocked are rewritten in place and never grow. Finish something, delete the
     line. Only Log appends. Format: /srv/projects/FORMAT.md -->

## Now

`main` is 86b4ae8 (#13, 2026-10-27), shipping #10–#12: the estimate rework, forced driver types and
E/Em own lines. The self-hosting app side (#9) has the companion probe, sent bug reports, build
names and badge. `dat-autodeploy.timer` keeps Connected on Pages' build. The host side, `/data/projects/dat_bridge`, is live on
`drivers.erikrees.co.uk` and `drivers-dev.wallcop.org`. Reports land in datajoin (#19 live
2026-10-27).

## Next

1. n8n overlay sync (plan §7): not built; needs the read/save gateway actions in datajoin first.
2. AUSTHZ shared driver parts: app and datajoin are live; prod and dev bridges don't serve
   `parts` yet, so the feature stays off. Deploy dat_bridge `shared-parts`, then have Erik run
   datajoin `oneoff/dat-research-2026-10-28/seed.py dev`, check on drivers-dev, then `prod`, and
   resolve AUSTHZ.

## Blocked / needs Erik


## Log

### 2026-11-03 — Emergency and feed marks (uncommitted)
- Emergency follows Erik's symbol_E.svg on Material's 24 grid: a teal (#08a8ac) triangle border, white inside, a black E, at 19px.
- Feed is Erik's orange (#ff8200) five-point asterisk. Both are inline SVG (`MARK` in EstimatePage.jsx).

### 2026-11-03 — Filter (Select All) (uncommitted)
- Each filter has an Excel-style (Select All) that ticks or clears every value, and shows part-ticked when some values are off. It replaces "Show all".
- A filter's list only ever opens itself, so re-ticking everything no longer collapses it.

### 2026-11-03 — Line flags as icons, UoM from DesignDB (uncommitted)
- Line flags are icons with the detail in the popup:
  - voltage, driver-watts and output-watts limits: Material Symbols `horizontal_align_right` (inline SVG, since the app's font lacks it)
  - outputs `call_split`, emergency `emergency`, feed `power`, forced `push_pin` / `report_problem`
- The only pills are the driver ElementType (#fbe9de) and the PositionTypes (#e6f2fc).
- DJ 100874 has no UoM column, so a dropped DesignDB's PositionTypes.UoM now fills it (`positionUoms`). C01r reads 13.4 m, not qty 13.4.

### 2026-11-03 — Feed chip, cyan emergency chip, forceable unsized rows (uncommitted)
- "may be emergency" and the new "Feed" chip (PositionType starting with F) are soft cyan. Feed rows aren't highlighted as warnings and don't count as unmatched.
- Rows with no CC/CV are grouped per PositionType. "Driver type for every F01" now lists them (it showed 0 rows before), and forcing a type sizes them by watts.
- The hub header W counts every row, so feed and unsized hubs no longer read 0W. Checked in Playwright on DJ 100874: P50440 shows 100W, and forcing ET-CCR-FEED-PROV gives 1 driver.

- 2026-11-03: Erik reported that the DesignDB refresh never prompted after a save in Excel, and that resume didn't either: a picked file had no handle, and nothing survived a reload. Now the dropzone click uses `showOpenFilePicker` where it exists, so picks get handles too. The handle and its `lastModified` go to IndexedDB (`persist.saveDesignDbHandle`), and resume re-watches it (`api.resumeDesignDb`). If the browser wants read permission again, the banner says "Check for changes", which asks once. Checked in Playwright with an OPFS handle: save → banner; reload + resume → banner; refresh → gone; reload → none. The permission-prompt path is untested, since OPFS handles are always granted. The filter popup lost its prose; Link_SecondaryPowerRef/ExtRef are default filters.
- 2026-11-03: Filter on any SP column: each requirement keeps its exported columns as `cols`. `rowFilter` is keyed by column name; ControlTypeRef, CC/CV, MAX_SecondaryPowerNodes and ControlAddressCount (whichever name the DJ uses) are always listed, and others are added from a select. The estimate's right-hand panel is now a `hub-bar` toolbar like the hub layout: Filter (with a count badge), Keep separate, Driver types, Export CSV, Copy Elements patch. Checked in Playwright. Sessions saved before this have no `cols`, so their filters list nothing until the SP CSV is loaded again.
- 2026-11-03: Standalone estimate has Excel-style pivot filters: ControlTypeRef, CC/CV, MAX_SecondaryPowerNodes (now parsed as `maxNodes`) and ControlAddressCount. Each is a tick list with row counts, offered only for columns the export fills. The filter stores the values left out, so a new value is in by default. It is kept per session as `state.rowFilter` and applied in `engine.estimate` via `filterRequirements`, so the patch follows it. The hero shows "N row(s) filtered out". Off when embedded. Checked in Playwright with DJ 100874: unticking LOCAL and a blank CC/CV took 30 hubs to 13, still 34 drivers. 365 tests pass. PR #32.
- 2026-11-03: Rows with no CC/CV SecondaryPowerType (LOCAL F01, mains) or no power were dropped silently, so a hub of them read "0 drivers" with nothing to open. planFromRequirements now lists them as grey `skipped` lines in `unmatched` (`no-power-type`, `no-load`) giving the reason. The hero shows "N not sized" apart from "unmatched", the row chip says "no CC/CV", and they get no force-type picker. The hub's W still counts sized rows only. Checked in Playwright with DJ 100874 + the 5642 DesignDB: P50440 shows "No CC or CV SecondaryPowerType…" and its row. 364 tests pass. PR #32.
- 2026-11-03: Feature requests (#31, merged to `dev` as 25f7c06): 8WQAAN, the working dialog's load bars span the full rating with the spare margin hatched. 5SVFZX, a row's ⋮ has "Driver type for every <PositionType>", which forces every line it is on (one FORCE_TYPE with `keys`). E7P24F, embedded, the estimate's patch dialog ticks in the other hubs saved in this branch+set, each sized with its own forced types. Asked for in chat: standalone, a DesignDB saved while open brings up "Refresh design data". A dropped file in Chromium gives a FileSystemFileHandle that is polled every 5 s and on focus; a picked file can only say it changed (NotReadableError), so it offers "Choose it again". "Not now" waits for the next save. Checked in Playwright: the refresh with a stubbed handle (Playwright copies uploads, so a real save can't be simulated); the bars and the per-type dialog (8 B02w lines forced). The multi-hub patch is covered by a round-trip test only, as it needs the overlay. PHCJ7A (toolbar redesign) not started: it needs a design call. 363 tests pass, build clean.
- 2026-11-03: "0 drivers for all": the real SP assessment is DJ 100874, which renamed `CC/CV`→`SecondaryPowerType`, `CV_Voltage`/`CC_Current`→`PositionVoltage`/`PositionCurrent` (0 = n/a) and `ControlAddressCount`→`Unit_ControlAddressCount`, so every row had no power type. parseAssessment reads both shapes; the zone is BestRef (`Link_SecondaryPowerExtRef` or the Ref), hubRef stays the Position Ref. With the 5642 DesignDB the real export now sizes 34 drivers; the CV hubs stay unmatched because that DesignDB's only CV driver has a blank ControlType. 362 tests pass. PR #32.
- 2026-11-03: #29 merged to `dev` (86d6dba), not on prod until the next ship: KJ3JBU, tooltips are positioned fixed on hover so a scrolling card can't clip them, and flip up near the window's bottom. 5KEFGM, new warning wording ("…estimate made": read the report's "mate" as "made") and the warning flashes three times on about one estimate open in three (off under reduced motion). BERMQB, the count dialog gives watts per the row's own UoM (`24 W per m`, `W/ft`), "each" only for counted fittings. CYUKHH, an own line from an E/Em PositionType carries a "may be emergency" chip that says to change the driver type if it is. FA49UX, clicking a faded driver type in the count dialog forces it; clicking the automatic one clears it. Checked in Playwright (5642 DesignDB, and demo data with CV rows in metres); 361 tests pass, build clean. Not done: E7P24F (amend multiple hubs into one patch) and 5SVFZX (change driver type for every line of a fitting type). Reports stay open until prod.
- 2026-11-03: #28 merged to `dev` (fa9b261), not on prod until the next ship: a DesignDB .xlsx can stand in for the driver type library. `src/designdb.js` ports the overlay's section-0 SELECT over the ElementTypes/Elements/Positions sheets and hands parseTypes() the same CSV. The import screen is a drop zone, a tick box per file (DesignDB, Secondary Power Assessment, Links, Driver Assignment) and a button per function the ticked combination supports (Secondary Power Assessment / Hub Spacing / Driver Assignment); no prose, no purple (the companion's). Dropped files are kept across drops. The type library CSV is not named in the UI, as nobody has one. SetupNotice has "Attach DesignDB" (standalone only). Fixed on the way: `parseAuto`'s has-cables probe used a one-column stand-in library that PapaParse can't delimit, so Links + Driver Assignment without a type CSV always failed standalone (also on `main`). Checked in Playwright with the 5642 sample DesignDB on all three routes; 361 tests pass, build clean. SheetJS (cdn.sheetjs.com 0.20.3, as PS&R) is lazy-loaded, its own 500 kB chunk.
- 2026-10-30: branch `fix/drawer-drag` to `dev`: dragging out of the Add drivers drawer did nothing (broken since #25). Pressing a card sinks the drawer and makes it ignore the mouse, so the cursor was suddenly outside `.hub-lab`, whose mouseleave cancelled the drag. A drawer drag now listens on the window. Checked in the harness: into a bay, into Not placed, released on nothing, and a block drag still works. Not resolved anywhere until prod.
- 2026-10-30: branch `ui/drawer-swing` to `dev`: drawer size previews default off; a card pulled out of the drawer swings (`hub-swing`, off under reduced motion); dragging the drawer's grab handle down more than 60px closes it, less springs back. Checked in the harness; 357 tests pass, build clean.
- 2026-10-30: branch `ui/drawer-preview` to `dev`: the Add drivers drawer has roomier cards (names wrap) with a to-scale footprint preview (toggle in the drawer head, `prefs.drawerSizes`, on by default). Dragging a card shows a cursor ghost at the drawing's scale while the drawer sinks out of the way. Add drivers moved out of the toolbar to a tab fixed at the bottom centre; the report pip sits on it (`body.hub-page`). Checked in the harness; 357 tests pass, build clean.
- 2026-10-30: branch `ui/layout-toolbar` to `dev`: hub layout UI redesign. PHCJ7A: one-row toolbar (Back, hub, size, View▾/Layout▾/Patch▾ menus, + Add drivers, undo/redo, Copy patch); selection actions float as a pill over the drawing, junction boxes only for one entity; notices are a bottom-right toast; the "lab" badge is gone. GPLPG4/UM7SG5: Add drivers is a drawer popping up from the bottom, styled like the tray, this hub's types first; drag a type into a bay or + to Not placed; the report pip rises with it. 7EQPAA: tray groups carry the size on a collapsible header, rows show the Ref only. 3YYKDT: Patch menu reads "Sizes the DB doesn't have yet". Bounding Lines (`prefs.bounds`, magenta) and Bill of Materials (`prefs.showBom`, off) are View toggles. Checked in the harness with Playwright; 357 tests pass, build clean. Doc screenshots not retaken. Reports stay open until prod.
- 2026-10-30: branch `fix/dat-reports-1030` (uncommitted): ZXP9N9, the BoM, moved to the hub layout page and shows ElementType Refs, including a supply's own type when the library has one. RANFZQ: the Not placed tray wraps and never scrolls. E5B3RC: Ctrl/Shift multi-select in that tray, dragged as one. 39NFYZ: the editor's reset lifts the supply clear of the junction boxes as the layout does, and is disabled when already reset. RXN4WV: the estimate dialog shows load per driver (the packer's split, or fill order); grouped runs still show the total only. 357 tests pass and the build is clean. Not checked in a browser. Not done: PHCJ7A (taskbar redesign) and GPLPG4 (Add drivers as a drawer) need a design decision.

- 2026-10-30: #22 (c53dbec) to `dev`: "Suggest a correction" in the type editor is a purple companion card, not a blue link and bare form. Swept for the same miss: suggested parts get the sparkle in the New type list; two tooltips said "shared". TZUNGU resolved. Not on prod until the next ship.
- 2026-10-30: shipped `dev` to `main` (#21, 584f49d "Rose Deer"), carrying #14–#20. Autodeploy reported `ok: prod 584f49d`, and the live page's build-commit meta matches.
- 2026-10-30: #20 merged to `dev` (eaabc08), fixing WLN3JW (BoM on the assessment and in the hub header; `bom()` in recipe.js), RRKMER (type cards wrap the name; usage line removed) and ASJ33S (Add stays in the card). The uncommitted BoM work in this checkout went into #20 and is kept as a stash. All 10 DAT reports are resolved; each fix reaches prod with the next ship from `dev` to `main`.
- 2026-10-30: #18 merged to `dev`. #19 (`shared-check-card`) merged to `dev`: it splits shared parts the PS&R way. A suggestion is an agreed value shown inline under the field as "✨ Suggested: X" (Material `auto_awesome`) with a flag button that files a bug report anchored on it. The Driver attributes wizard marks parts "suggested" / "to check" and its "This writes" header shows Suggested + flag once the part is checked. An unchecked value is never offered: it is only asked about in the purple card, which compares it with its datasheet ("These look wrong") and asks "Are these ratings right for X?". The word "shared" and the source link are gone. `conflicts()` is in catalogue.js and tested. Verified in Playwright against a mocked catalogue.
## 2026-10-30

- PR #18 to `dev`: the bug reporter is now companion-kit 1.1.1 (api.github.com tarball + `.npmrc` token), with the once-per-tab opened ping. Tests and build pass; checked in a browser against a mocked companion. CI green once Erik set the `COMPANION_KIT_TOKEN` repo secret.

## 2026-10-29

ASJ33S: on "Add a driver to HUB-X" the Add button spilled out of narrow cards. Two causes: the
button padding sat on the wrapper span, and the usage text could not shrink. Now the usage text
truncates first, with the full list in its title. Checked at 1920 px and at the 280 px minimum card
width. WLN3JW: a "Bill of materials" (`Bom.jsx` over `recipe.bom()`) lists each type's driver part,
its supply and the default junction boxes (`defaultJboxes`, moved into `recipe.js`). On the
assessment it counts the estimate; in a hub's assignment header it is a dropdown counting the hub's
drivers, without feed provisions. Junction boxes edited per module in the layout are not counted.
Not committed.

- VMNW7Y: the hub layout hears Del (selection back to the tray, a layout undo step) and Ctrl+C /
  Ctrl+V (an ADD_DRIVER per copied type, placed just after the original through `pasting` in the
  redraw effect). Shift-click multi-select already worked; the hint line now names all four.
- MNBJ6W: "None - supplied elsewhere" (`NO_SUPPLY`) for a DC/DC driver's supply in New type and
  the setup wizard. The type is then the driver alone, with its watts left blank.
- Shared parts now also carry `sizeMm`, `jboxes` and a DC/DC driver's `psu`, through the share form,
  the check card, and datajoin `_dat_part` (branch `dat-parts`; its test is written but not run here,
  because docker was refused and the host has no `mcp`). `checked(part, key)` is the only reader. It
  fills a datasheet gap from an agreed amendment and never overrides the datasheet. Amendments are now
  voted on in the preset editor. Type attributes were already shared, but only on an explicit "Share…".
  A shared size shows as "suggested" in the layout and still goes into the patch. "Fill in all" pairs
  a DC/DC driver with its agreed supply. datajoin `test_psr_app.py`: 55 pass. It was run with a stub
  `mcp` module (`scratchpad/run_dat.py`), because docker and venv are unavailable here. The share
  form was checked in the browser against a mocked companion: the POST carries
  `sizeMm`/`jboxes`/`psu`.
  Merged to `dev` as #17 (307b9c9). The datajoin side is #23 (6c13c5a), autodeployed.

## 2026-10-28

- Shared parts carry no chip in the part list or dropdowns any more (Erik's call). The check card is
  the only sign of one. The Origin chip on a filled value says "suggested".
- Shared parts are checked by a second person, PS&R's way (suggestion_votes, `_tally`). Sending is
  the sender's yes; `checkOf()` in `catalogue.js` says confirmed / agreed (2 yes from 2 origins) /
  yours / unchecked, and a newer "no" asks again. `SharedCheck` asks Yes / No / Not sure in the
  editor and the setup wizard. An unchecked part is never filled by "Fill in all" or "Use this".
  Parts can carry per-current `windows` (TCI MP 32 is 19W/54fV at 350mA, 32W/46fV at 700mA),
  applied by `atCurrent()` in faults, fixes, fills and the editor. SetupNotice now flags in-use types
  a datasheet or checked part disagrees with (`disagreeing()`). 28 researched parts are ready as a
  seed in datajoin (origin `research`, with a source link). PR #32.
- Four more reports, uncommitted on `feat/shared-parts` (already merged as #15): WNUC6N wording
  "no attributes filled in"; MBVCAZ the setup offer says "in the DesignDB" and counts types filled
  here awaiting the patch (`engine.filledHere`); MBTBA2 a line whose fittings differ in size is packed
  fitting by fitting (`engine.packLine`, first-fit decreasing onto outputs, then outputs onto
  drivers) instead of every fitting counting as the largest, and its working shows a card per fitting type and per output (what is on it, volts and watts summed against the limits, why nothing more fits); SSCMMX the line's driver type select moved behind a ⋮
  "Change driver type" (still shown when forced). KWZZDH left open: needs the K6002 data checked.
  352 tests green, build clean, not clicked through.

- New reports: KWZZDH duplicate LinkRef K6002 now names the rows and differing columns (data not
  checked: Kaizen was down); a crash before INIT carries the host's context. YMD8JN the multi-run
  watts bound counted watts, not whole fittings (10 x 30W on 100W = 4 drivers, said 3); working says
  fittings are never split. U5EN7Q: the working's Fittings step now names the PositionTypes (aca899f). Report data: trail now carries each click's
  debug areas, the app's own dialogs are captured, estimate lines/options are tagged; datajoin's
  listing showed every DAT trail as null and hid estimate/patch (fixed on `dat-parts`).
- AUSTHZ, shared driver parts (scope: parts only; trust: live as observed). datajoin `dat_parts`
  table + `GET|POST /gateway/dat/parts`; bridge `companion/parts` (20 r/min, 8k body); app
  `setSharedParts` in catalogue.js, shared chip, amendments offered beside the datasheet, Share form
  under the type editor, origin `shared` in Review. 351 tests green, build clean, clicked through
  with a mocked companion. Not deployed. Docs: `docs/companion.md`.

- Worked the 8 open `dat` reports (PR to `dev`; reports resolved once on prod):
  B3TPLM a pending fix clears its type's "to check" flags; FTQH78 bug pip counts unsent only, menu
  gets "Send N unsent"; 6QSCLN types page goes back to the page that opened it; TZY2VC working is a
  dialog, one at a time; MEBAP4 `.dp-list` no longer clips row menus; RAJ9XJ "Own line" is stored
  per set, not per hub; FTGR6Z embed parse failure shows the crash card with Send, and says "data
  from DataJoin" not "CSV". AUSTHZ (shared type catalogue via companion) not started.

## 2026-10-27

- Shipped `dev` to `main` (#13, 86b4ae8); the Pages deploy run succeeded.
- Own line per PositionType (merged to `dev` in #12). A PositionTypeRef suffixed `E` or `Em`, case-sensitive (the emergency variant, e.g. `B02wE`), is taken out of a bundled estimate line onto its own line by default. Any type can be toggled in or out from the row's ⋮ menu (`OWN_LINE`, `state.ownLine`, saved with the session; engine `isOwnLine`). This only matters while "Fitting types" is not kept separate per driver. 347 tests green, build clean; not clicked through.
- Force a driver type per estimate line (merged to `dev` in #12). There is a "Driver type" select on each line. `FORCE_TYPE` stores the choice in `state.forcedTypes`, keyed by zone and line key, and it is saved with the session. The engine sizes the forced type even when it does not match the fittings, and flags it as `mismatch` (a red step and a "⚠ forced" chip). If the type cannot be sized, it keeps the automatic pick and reports `forcedIssue`. The working still shows the automatic pick as an untaken branch. 346 tests green, build clean, clicked through on HUB-A.
- Estimate working with several ControlGroups (merged to `dev` in #12). ControlGroups now always sit on separate outputs. An output is dimmed as one, so the per-output box is locked on and `prefs.nodeControlGroup` is gone. The working shows one step per group or per fitting type: "qty ÷ per = N outputs". After those comes "Drivers = max(outputs ÷ n, W ÷ usable W)", and a new `outputs` limit chip. Each line also lists the driver types it compared and why each lost (`considered`, using the same order as the ranking). Clicked through on demo HUB-A. 344 tests green, build clean. Erik turned down the vertical trace and kept the left-to-right row. Wherever the engine chose, the row now shows a fork: the options stacked in one column, the taken one solid and the others dashed. The forks are driver type, the tightest per-driver limit, each group, and enough drivers for both outputs and watts. "Prefer single output" became "Pick by": Single output, Fewest drivers or Spare outputs (`prefs.pickBy`, `PICK_BY` in the engine). Emergency stock always loses, and the reason a type lost comes from the same rules. 345 tests green.
- ContextRef bug (merged to `dev` in #11). The estimate patch wrote the hub label as `Elements.ContextRef`,
  and the assignment patch fell back to it. Both now take the Position Ref: the host's
  `hubRef`, or the assessment's `Link_SecondaryPowerRef`. When neither is known, ContextRef is left
  blank with a CHECK note. 342 tests green.
- Demo data for the assessment (merged to `dev` in #11): every cabled demo hub now carries assessment rows
  rolled up from its own cables (CC counted per cable; CV strip as metres at 24 W/m, as HUB-J
  does). So Cables vs Assessment and "Estimate and hub disagree" can be seen on any hub. HUB-J
  gained a no-load row that must add no driver.
- Fixed the three filed reports (merged to `dev` in #10, 329f0c9). RSM4NL: on resume `api.js` had no model,
  so App now hands it over (`domain.adopt`). ZQTY7D: rows with no load are left out of the estimate.
  CGNAM8: the Elements patch names rows after their ControlGroups, with a choice of one row per
  driver (Quantity 1) or one per type per hub. That choice lives in a "Copy Elements patch" dialog
  with a preview of the rows, and is remembered across sessions (`prefs.patchPerDriver`). Resume and
  the dialog were clicked through with no error. The crash screen now leads with "Send the report"
  whenever a companion answers; a forced crash posted `kind: crash` to a mocked companion. 341 tests green, build clean. Filing is unconfirmed, because Kaizen was disconnected.
- Estimate list redone (merged to `dev` in #10): one foldable line per type, a limit chip with a
  popup, rows with load and drive chips, and the working folded away. The engine returns `working` per
  line, and "Calculation looks wrong" sends it as `estimate`. Header redone as Erik's pick G: "Secondary
  Power Assessment", the result card left, and an assumptions panel right ("Keep separate" grid and
  "Driver type restrictions", each with an info popup).
- datajoin #19 live; a test report arrived (6ABJU2, resolved).
- Bridge live (see `dat_bridge/STATE.md`); Erik dropped the stale V1.11 overlay stash.
- GitHub: `dev` is the default branch; `main` is protected on the `test` check (admins exempt).
- "Report an issue" without report mode: a ⋮ on each assessment row (sends the row's loadings,
  not its location), the same item on every driver card, and a Report flag in Review changes that
  sends what the patch would change as refs and node keys (`patch`). Clicked through against the
  mock companion; one sent. 338 tests green. Seen, not fixed: a left-column driver's ⋮ menu opens
  under the tray.
- Actioned the self-host plan, taking §9's recommendations: nginx plus a datajoin gateway door (not
  a bridge service), a new private `dat_bridge`, its own `dat-autodeploy.timer`, Kaizen embed left on
  Pages, and overlay sync from `main` only. `dev` branch created and pushed. A report is sent only
  on a click, built from allowlists, with a preview of the payload. Builds carry PS&R-style names.
  Screenshots taken against a mock companion (`docs/companion.md`); Send round-tripped ("Sent QFFDRW").
  Not shot: the crash screen. 336 tests green.
- Auto-deploy brought in line with the PS&R tool: renamed `deploy.yml` → `pages.yml`, which now
  runs `npm test` before the build (test gates the deploy) and skips doc-only pushes via
  `paths-ignore`. Added `ci.yml` running test + build on every PR and non-`main` push, so `main`
  can be branch-protected on that check and a red suite is caught before merge, not by a failed
  deploy after it. 314 tests green locally. The embed env var and `main` as the branch are kept.
- Researched and planned self-hosting with a companion, a dev channel and n8n overlay sync
  (`SELFHOST_PLAN.md`). Findings:
  - The companion can't live at `./api/`, which is the embed entry. Use `./companion/`.
  - The gateway 404s `cf-ray` traffic, so browser reports need their own door and token.
  - Overlay drift is real: local V1.11 against live V1.14.

## 2026-10-21

- Rebased the two local record commits onto PRs #1–#3 and pushed (main was diverged 2/3). The
  uncommitted `sysex-overlay-DJ101681.sql` is untouched.

## 2026-09-17

- **Adopted the two-file record format** (`/srv/projects/FORMAT.md`). Added `CLAUDE.md`; this repo
  had none, though `README.md`, `ARCHITECTURE.md` and `EMBEDDING.md` were already strong — the gap
  was a single place stating the constraints and where things live, rather than a reader inferring
  them from three documents.
- **Deleted `ASSIGNMENT_UX_CHECKLIST.md`**, its content folded into the entries below. Every box in
  it was ticked, and it described a `validation.py` / `main.py` backend with a `POST /eligibility`
  endpoint — architecture this app no longer has, having become static and client-side. A finished
  work log kept next to the code reads like current design and actively misleads. This is exactly
  the state-vs-documentation split the format exists to enforce.
- **Deleted `.claude/RESUME.md`** — an auto-checkpoint from 2026-08-25 pointing at
  `refs/claude/checkpoint-0c16b623`, expired about two weeks later, for a session that lives on
  pathfinder. It was also why `.claude/` showed as untracked dirt in `git status`.
- Kept `REFRESH-catalogue.md` rather than folding it in, deviating from the plan: it is a durable
  how-to that would not need editing when any piece of work finishes, so by the format's own test it
  is documentation. It is linked from `CLAUDE.md`'s Map.

## 2026-09-16

- Keep the spacing layout, start it blank, and name a crash instead of blanking the screen.
- Shrink a bay under half a column and it merges into its neighbour.

## 2026-09-15

- Show what the space layout writes, scenario by scenario — `docs/hub-layout.md` with screenshots.
- Everything in the hub, a tray for what is not placed, and pieces as space groups.
- Draw a driver row with a `Quantity` as a stack, and break it apart into rows.
- Recreate the hub from the DB alone: sized spaces, driver parts, resizing on a snap. The space
  layout writes only Parameter Syntax, so another tool can draw the same hub from the DB alone.

## 2026-07-07 — workflow rounds 2 and 3

- Session autosave and resume via localStorage; the import screen offers Resume or Start fresh.
- Zone triage dashboard, sortable by problems / orphans / capacity / unassigned / name.
- Change ledger: Redo, plus per-row revert-to-baseline in Review.
- Global locate search — find any link or driver ref and jump to its zone.
- Multi-select bulk move: Ctrl/⌘-click toggles a selection set, best-fit by intersection.
- Cable-label config, tray drill-down filters, ordered zone colours, demo data and tutorial.
- Drag-drop import of both files at once, `detectKind` by header signature.
- 21 tests green.

## 2026-07-06 — assignment UX pass

- Reframed the UI as decide-support rather than record-keeping: surface the constraints that
  actually rule placements in or out, quiet the ones that do not.
- The insight that shaped it: for real data the decision is "same ControlGroup and fits the watts".
  CC/CV is a trivial eyeball, CV voltage is a no-op at 24 V throughout, CC current is unpopulated.
- Shipped: dim the impossible, ControlGroup as tray spine with place-group, fill-this-node, target
  count with forced-move badges, actionable-vs-expected warning split, provision links into a
  collapsed lane, and suggest-a-driver-to-add clustering orphans by fingerprint.
- Then implemented against a Python backend (`validation.py`, `main.py`, `POST /eligibility`). That
  backend was later removed when the app became static; the same logic now lives in `src/engine.js`
  and the tests were ported from pytest to `node --test`.
