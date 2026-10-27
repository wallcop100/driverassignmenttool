# driverassignmenttool — state

Updated: 2026-10-27

<!-- Now / Next / Blocked are rewritten in place and never grow. Finish something, delete the
     line. Only Log appends. Format: /srv/projects/FORMAT.md -->

## Now

The app side of self-hosting is shipped (`main` 54deb0c, #9, 2026-10-27): companion probe, sent bug
reports, build names and badge. `dat-autodeploy.timer` keeps Connected on Pages' build. The host side, `/data/projects/dat_bridge`, is live on
`drivers.erikrees.co.uk` and `drivers-dev.wallcop.org`. Reports land in datajoin (#19 live
2026-10-27).

## Next

1. n8n overlay sync (plan §7): not built; needs the read/save gateway actions in datajoin first.

## Blocked / needs Erik

Nothing.

## Log

## 2026-10-27

- ContextRef bug (uncommitted). The estimate patch wrote the hub label as `Elements.ContextRef`,
  and the assignment patch fell back to it. Both now take the Position Ref: the host's
  `hubRef`, or the assessment's `Link_SecondaryPowerRef`. When neither is known, ContextRef is left
  blank with a CHECK note. 342 tests green.
- Demo data for the assessment (uncommitted): every cabled demo hub now carries assessment rows
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
