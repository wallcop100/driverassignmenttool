# Architecture

## What this is

A visual bin-packing tool for the Lighting DesignDB secondary-power workflow: it takes two DataJoin CSV exports (a Links Assignment file and a Driver Assignment form), lets a designer drag/click links onto driver output nodes, live-validates each placement against the same rules as the `DriverHealthCheck.sql` health check, and exports an updated Driver Assignment CSV — plus, for changed rows, a copy/paste ExcelScript patch for `LinksMap`.

It is a **static, client-side-only web app**. There is no server, no database, and no build-time secret. Everything — CSV parsing, validation, bin-packing, CSV/script generation — runs in the browser. That single decision shapes almost everything else in this document.

## Why static-only

- **Zero install, zero server to run or pay for.** It deploys to GitHub Pages via a plain `vite build` and a GitHub Actions workflow — `git push` is the entire release process.
- **The data never leaves the browser.** CSVs are read with the File API and processed in memory; nothing is uploaded anywhere. For a tool that handles a client's design data, that's a real property, not just a convenience.
- **The problem doesn't need a server.** Parsing, validation, and bin-packing are pure functions over a few hundred rows — trivial for a browser tab, and a backend would only add deployment surface for no benefit.

All of the logic — CSV parsing, validation, bin-packing, CSV/script generation — lives in one JS module, [`src/engine.js`](src/engine.js), that the UI calls directly.

## Stack

| Layer | Choice | Why |
|---|---|---|
| UI | **React 18** (function components + hooks) | The screen is a tree of stateful, interactive views (tray, driver grid, modals) reacting to one shared store — React's component model fits directly, and it's the most common choice for exactly this shape of app. |
| Build | **Vite 6** | Fast dev server, trivial static-site output (`vite build` → `dist/`), and `base: './'` makes the output relocatable to a GitHub Pages subpath with no other config. |
| State | Hand-rolled **reducer** (`useReducer`, no library) | One `state.js` reducer with ~19 action types (`MOVE`, `DISTRIBUTE`, `UNDO`/`REDO`, `ADD_DRIVER`, …) is the entire app's state machine. Redux/Zustand/etc. would add a dependency and boilerplate for what a plain reducer already does — the whole point of `useReducer` existing in React. |
| CSV parsing | **PapaParse** | The DataJoin export format has quoted fields, embedded commas, and BOM headers that a hand-written split(',') would mishandle. This is the one place a dependency earns its keep over a few lines of code. |
| Styling | **Bootstrap 5** (CSS only, no JS/jQuery) + hand-written CSS in `styles.css` | Bootstrap supplies layout/utility classes and modal/badge primitives for free; the bin-packing-specific visuals (driver bins, node slots, cable blocks, tooltips) are bespoke CSS since nothing off-the-shelf models them. |
| Icons | **Material Icons** (font) | One `<link>`-free npm package, consistent icon set, no SVG sprite plumbing. |
| Tests | **Node's built-in `node:test`** | `src/engine.js` and `src/state.js` are pure functions with no DOM dependency, so they run directly under plain Node (`npm test` → `node --test test/`) — no Jest/Vitest/jsdom needed. |
| Deploy | **GitHub Actions → GitHub Pages** (`.github/workflows/deploy.yml`) | Push to `main` → `npm ci && npm run build` → publish `dist/`. No hosting account, no server to patch. |

No backend framework, no database, no state-management library, no CSS framework beyond Bootstrap's base layer, no test framework beyond the runtime's own — each omission is a conscious "the platform/stdlib already does this."

## High-level flow

```
┌─────────────┐   File API    ┌──────────────┐   pure fns    ┌───────────────┐
│  Two CSVs   │ ───────────►  │  engine.js   │ ───────────►  │  model object  │
│ (drag-drop  │  (PapaParse)  │ buildModel() │               │ zones, drivers,│
│  or Demo)   │               │              │               │ links, baseline│
└─────────────┘               └──────────────┘               └───────┬───────┘
                                                                       │
                                                                       ▼
                                                          ┌─────────────────────┐
                                                          │   App.jsx (root)    │
                                                          │  useReducer(state.js)│
                                                          └──────────┬──────────┘
                                                                     │ dispatch(action)
                        ┌────────────────────────────────────────────┼──────────────────────────┐
                        ▼                                            ▼                           ▼
                 ┌─────────────┐                            ┌────────────────┐          ┌────────────────┐
                 │  Landing    │                             │    ZonePage    │          │  api.js calls  │
                 │ (zone list) │                             │ Tray + DriverGrid│         │ engine.validate│
                 └─────────────┘                             └────────────────┘          │ .eligibility() │
                                                                                            │ .distributeGroup()│
                                                                                            └────────┬────────┘
                                                                                                     ▼
                                                                                            flags / suggestions
                                                                                            fed back into state
```

1. **Import** ([`ImportScreen.jsx`](src/components/ImportScreen.jsx)) — the user drops both CSVs (order doesn't matter; [`engine.detectKind`](src/engine.js) sniffs headers to tell them apart), or clicks the low-key "Use Demo Data" affordance to load a bundled sample dataset (`src/demo/`). [`engine.buildModel`](src/engine.js) parses both files into one `model`: zones, drivers (with parsed wattage/current/voltage limits), links, the driver-type inventory, and a `baseline` map of the imported assignments.
2. **Store** ([`App.jsx`](src/App.jsx) + [`state.js`](src/state.js)) — a single `useReducer` holds the model, the live `assignments` map (`"driverRef|node" → link refs`), undo/redo stacks, UI mode flags (drag, multi-select, distribute-mode, fill-node mode), and preferences. Every edit is one dispatch; every dispatch pushes an undo frame.
3. **Derive** — `App.jsx` re-runs `engine.validate()` and `engine.eligibility()` in `useEffect`s keyed on `[model, assignments, addedDrivers]`, via a thin async wrapper [`api.js`](src/api.js) that keeps the engine calls behind a stable, promise-based interface.
4. **Render** — [`Landing.jsx`](src/components/Landing.jsx) shows per-zone completion/capacity with sortable triage; [`ZonePage.jsx`](src/components/ZonePage.jsx) is the main editor: a `Tray` of unassigned links grouped by ControlGroup, and a `DriverGrid` of driver bins with node slots, both reading the same derived `flags`/`eligibility` to color-code and gate what's droppable where.
5. **Export** ([`ReviewModal.jsx`](src/components/ReviewModal.jsx)) — a diff view of every changed row, with two outputs: `engine.exportCsv()` (an updated Driver Assignment CSV, byte-compatible with the original schema, re-importable to resume) and `engine.generatePatchScript()` (an ExcelScript that patches DesignDB's `LinksMap` for just the changed rows, copied to the clipboard for pasting into Office Scripts).

## Why the engine is one plain module, not a class hierarchy

`engine.js` is ~500 lines of exported functions taking a `model` and returning new data — no classes, no internal mutable state, no singleton. Every function (`validate`, `eligibility`, `distributeGroup`, `exportCsv`, `generatePatchScript`) is independently callable and testable with a plain object literal, which is exactly how `test/engine.test.mjs` uses them: build a small synthetic model, assert on the output, no mocking. Given the whole engine is a pipeline of "take this data, compute that data," functions are the entire toolkit needed — an object-oriented layer on top would just be indirection.

## Persistence

There is no database. Two localStorage entries do the only persistence this app needs:
- **Session autosave** ([`persist.js`](src/persist.js)) — the model + assignments + prefs, so a page refresh mid-edit doesn't lose work; offered back as "Resume" on the import screen.
- Everything else (the source CSVs, the exported CSV, the patch script) is a file the user explicitly downloads or copies — the app never silently sends data anywhere.

## Where validation logic actually lives (and why it matches the SQL)

The authoritative check is still `DriverHealthCheck.sql` running inside DataJoin against live DesignDB tables this app never sees (`#LinksMap`, `#EntityLoads`, `#ElementTypes`). This tool's `engine.validate()` is a **client-side pre-flight**, deliberately kept in lockstep with the same rules (CC/CV type match, CV voltage, total/per-node wattage, series forward-voltage, CC current within a 10% band, ControlGroup uniformity) so a designer catches most problems before ever running DataJoin — but it explicitly skips checks that need data only DataJoin has (e.g. node-name validation against `ElementTypes.Parameters`). The `MISMATCH` vs `FAIL` vs `WARN` severity split is this tool's own visual invention layered on top of the SQL's binary FAIL/WARN — both `FAIL` and `MISMATCH` count as "actionable" everywhere in the UI.
