# Driver Assignment Tool

Visual bin-packing UI for assigning links to driver output nodes per pullzone
(Lighting DesignDB schema 4.5 secondary power workflow). A **static, client-side
React app** — CSV parsing, the DriverHealthCheck validation engine, and export
all run in the browser ([src/engine.js](src/engine.js)). No server, no backend.
See `pullzone-bin-packing-ui-spec.md` and `PROCESS.md` for the design.

## Run (dev)

```
npm install
npm run dev
```

Load the two CSVs from `sample-data/` on the import screen. A previously exported
Driver Assignment CSV can be re-imported to resume.

## Test

```
npm test        # node --test: engine parse/validate/eligibility/export vs sample-data
```

## Build

```
npm run build   # -> dist/ (static, deployable anywhere)
npm run preview # serve the built site locally
```

## Deploy (GitHub Pages)

Pushing to `main` triggers [.github/workflows/deploy.yml](.github/workflows/deploy.yml),
which builds and publishes `dist/` to Pages. Enable it once under
**Settings → Pages → Source → GitHub Actions**. `vite.config.js` uses
`base: './'` so assets resolve under the project subpath.
