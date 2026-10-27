# driverassignmenttool — state

Updated: 2026-10-27

<!-- Now / Next / Blocked are rewritten in place and never grow. Finish something, delete the
     line. Only Log appends. Format: /srv/projects/FORMAT.md -->

## Now

Planned, not built: self-host (Connected edition), companion bug reports, `dev` channel, n8n overlay
sync. Plan in `SELFHOST_PLAN.md` (local only, git-excluded: it names the backend).

## Next

1. Pull: the local clone is behind `origin/main` by PRs #4–#8. Then commit the uncommitted
   `pages.yml`/`ci.yml` on the fresh base.
2. The dirty local `sysex-overlay-DJ101681.sql` (V1.11) is stale: origin and live DJ 101681 are
   V1.14, revision 97. Discard it on Erik's word.
3. Protect `main` on `CI / test` (not set, verified 404).
4. Then plan phases 1–2 (public repo only).

## Blocked / needs Erik

- 🛑 Six decisions left in `SELFHOST_PLAN.md` §9. Hostnames and data tiers were decided
  2026-10-27: `drivers.erikrees.co.uk` and `drivers-dev.wallcop.org`. A report sends the flagged
  row's Element IDs, types and loadings, plus branch and set IDs.

## Log

## 2026-10-27

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
