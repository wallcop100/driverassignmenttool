---
name:     driverassignmenttool
summary:  Driver sizing and bin-packing UI for the Lighting DesignDB secondary-power workflow
status:   active
host:     none
path:     /data/projects/driverassignmenttool
repo:     https://github.com/wallcop100/driverassignmenttool
url:      https://wallcop100.github.io/driverassignmenttool/
companion: dat
---

# driverassignmenttool

Recorded in the format at `/srv/projects/FORMAT.md`. Live state is in `STATE.md` beside this file.

## What this is

A static, client-side React app for the Lighting DesignDB secondary-power workflow. It takes
DataJoin CSV exports, lets a designer place cables onto driver output nodes, live-validates every
placement against the same rules as `DriverHealthCheck.sql`, and exports an updated Driver
Assignment CSV plus an ExcelScript patch for `LinksMap`.

It works out which of its three modes it is in from the data, not from which file was dropped —
`detectMode()` in `src/engine.js`. Embedded, the host is DJ 101681.

## Where it runs

| | |
|---|---|
| Host | none — static, no server, no backend, no database |
| Path | `/data/projects/driverassignmenttool` |
| Published | https://wallcop100.github.io/driverassignmenttool/ (verified 200, 2026-09-17) |
| Deploy | push to `main` → `.github/workflows/pages.yml` → `npm ci && npm test && npm run build` → Pages |
| CI | `.github/workflows/ci.yml` — test + build on every PR and non-`main` push; protect `main` on this check |
| Embedded in | DJ 101681, via `sysex-overlay-DJ101681.sql` — see `EMBEDDING.md` |
| Connected | the same build self-hosted with a companion (bug reports sent, not just saved) — a private bridge on rosetta; see `docs/companion.md` |
| Branches | work goes to `dev` (CI only); `main` is what Pages serves |

```bash
npm install && npm run dev      # dev server
npm test                        # node --test
npm run build                   # -> dist/
```

## Hard constraints

- **Static and client-side only. Never add a server, a database, or a build-time secret.** The data
  never leaving the browser is a real property of a tool handling clients' design data, not a
  convenience. A backend would add deployment surface for no benefit — parsing, validation and
  bin-packing are pure functions over a few hundred rows. The one exception is the optional
  companion (`src/companion.js`): the app must stay complete without it, and only a bug report the
  person chooses to send leaves the browser, built from allowlists in `remoteReport()`. Never send
  a CSV, the session, or any free text from the screen.
- **`src/engine.js` stays plain exported functions over a `model`** — no classes, no internal mutable
  state, no singleton. That is exactly how `test/engine.test.mjs` uses them: build a synthetic model,
  assert on the output, no mocking. An OO layer would be pure indirection.
- **`engine.validate()` must stay in lockstep with `DriverHealthCheck.sql`.** It is a client-side
  pre-flight, not the authority — the SQL running inside DataJoin against live tables this app never
  sees is. It deliberately skips checks needing data only DataJoin has, such as node-name validation
  against `ElementTypes.Parameters`. If the SQL's rules change, change these too.
- **Never rename a `Ref`.** It is the key Elements point at. Where the Ref and the Name disagree
  about current, both are offered and the choice corrects the *Name*.
- **The exported CSV must stay byte-compatible with the original schema**, because re-importing one
  is how a designer resumes. Parsing requires only the signature columns, so added or removed
  optional columns break neither old nor new files.
- **`src/catalogue.js` is static on purpose** — the app runs as a sandboxed iframe on GitHub Pages
  and cannot reach Kaizen at runtime. Regenerate it deliberately via `REFRESH-catalogue.md`.
- **Playwright is a local tool, not a dependency.** It is deliberately absent from `package.json`:
  200 MB of browser has no business in the install for a static app. `npm i --no-save playwright`
  when you need to retake screenshots.
- **Keep `base: './'` in `vite.config.js`.** Three entries build into one Pages artifact and relative
  asset paths are what let them coexist with no base-path juggling.
- **"In the hub but not placed" is the absence of a space, not an error.** A renderer must list those
  Elements beside the drawing, never drop them.

## Map

| Path | What it is |
|---|---|
| `src/engine.js` | all the logic — parse, validate, eligibility, bin-pack, CSV and patch generation |
| `src/state.js` | the whole app state machine: one `useReducer`, ~19 actions, undo/redo per dispatch |
| `src/App.jsx` | root; re-runs `validate()`/`eligibility()` in effects keyed on model+assignments |
| `src/api.js` | thin promise-based wrapper keeping engine calls behind a stable interface |
| `src/catalogue.js` | 34 driver parts transcribed from the Driver Specs page group |
| `src/components/` | ~30 components; `ImportScreen`, `Landing`, `ZonePage`, `Tray`, `DriverBin`, `ReviewModal` are the spine |
| `src/persist.js` | the only persistence — session autosave to localStorage, offered back as "Resume" |
| `src/companion.js` | probes `./companion/capabilities` once; null on Pages |
| `src/build.js`, `src/buildNames.json` | build commit, channel and name (stamped by `vite.config.js`), shown as the bottom-right badge |
| `test/` | `node:test`, no Jest/Vitest/jsdom — the engine and reducer are pure and need no DOM |
| `docs/screens.mjs`, `docs/shoot.mjs` | re-render every surface and retake screenshots in one pass |

Deeper documents, linked rather than duplicated:

- `README.md` — the three modes, the catalogue, running, building, deploying.
- `ARCHITECTURE.md` — why static-only, the stack table with the reasoning per choice, the full
  import→store→derive→render→export flow, and how a hub layout is stored.
- `EMBEDDING.md` — how it embeds in the host DataJoin via postMessage.
- `docs/hub-layout.md` — scenario by scenario, with screenshots, what the space layout writes.
- `REFRESH-catalogue.md` — how to regenerate `src/catalogue.js` from Kaizen.

## Verify

```bash
npm test          # engine parse/validate/eligibility/export, reducer, catalogue, hub layout, embed
npm run build     # must be clean
npm run preview   # serve the built site and click through
```

On a UI change, retake the documentation images in one pass so they cannot drift:

```bash
node docs/screens.mjs      # -> docs/*.html
node docs/shoot.mjs        # -> docs/img/*.png
node docs/hub-layout-shots.mjs
```

## Gotchas

- **DesignDB names parts by product code, with lookalike characters.** `SL0240A3` has a zero where
  the letter O belongs, and `SLO560S3`/`DL0560S3` differ by prefix only. Matching is by model token
  because the names are free text. Add aliases **from the data, not from the spec page**.
- **Spec pages are duplicated into every project's own book** — SoloDrive 360/A exists four times.
  Project 123, *Lighting and Shading Technology*, is the master. The copies agree today and nothing
  enforces it; if they ever disagree, 123 wins and the difference is worth reporting.
- **The ElementTypes library states a max power for only ~4% of driver types**, so most of the time
  the tool must size a driver whose ratings nobody wrote down. The type's `Name` almost always says
  which part it is — that is why the catalogue exists at all.
- **`MISMATCH` vs `FAIL` vs `WARN` is this tool's invention**, layered on the SQL's binary
  FAIL/WARN. Both `FAIL` and `MISMATCH` count as actionable everywhere in the UI.
- **The overlay file drifts from live DJ 101681** because agents save in Kaizen and hand-copy back
  (2026-10-27: the local file said V1.11 while live was V1.14, revision 97). Check `get_datajoin`'s
  `revisionref` before trusting the file. Its `sqlincludes` field carries per-include tokens. Never
  copy it into a file or into chat.
- **`Elements.ContextRef` is always the hub's Position Ref**, never its label. The label (Pullzone,
  `zone`) is COALESCE(ExtRef, Ref), so it is not a key on a hub with an ExtRef. The Ref comes from
  the host's `context.hubRef` or an assessment row's `Link_SecondaryPowerRef` (`hubRef`). When
  neither is known, ContextRef is left blank with a CHECK note (2026-10-27).
- **`src/api.js` holds its own module-level `model`**, set only by the parse functions. Any path
  that puts a model into state some other way, like a resume, must hand it over via `domain.adopt`
  or the engine runs against null (2026-10-27).
- **ControlGroups never share an output** — an output is dimmed as one. In the estimate only the
  per-driver rule is a choice; per output it is always on (2026-10-27).
- **A forced driver type is keyed by `zone|line key`**, and the line key comes from the
  Keep-separate options. Changing those options re-buckets the lines, so earlier forced choices
  quietly stop applying (2026-10-27).
- **For real datasets the deciding constraints are ControlGroup and capacity.** CC/CV is a trivial
  eyeball, CV voltage is a no-op (all 24 V) and CC current is unpopulated — so surfacing those two
  loudly and quieting the rest is deliberate, not an oversight (2026-07-06).
