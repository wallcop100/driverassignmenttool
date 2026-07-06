# Driver Assignment Tool

Visual bin-packing UI for assigning links to driver output nodes per pullzone
(Lighting DesignDB schema 4.5 secondary power workflow). Electron + React
renderer, Python (Flask) sidecar that owns CSV parsing, the health-check
validation engine, and export. See `pullzone-bin-packing-ui-spec.md` and
`PROCESS.md` for the design.

## Run (dev)

```
pip install -r sidecar/requirements.txt
npm install
npm run dev
```

Load the two CSVs from `sample-data/` on the import screen. A previously
exported Driver Assignment CSV can be re-imported to resume.

## Test

```
npm run test:py    # validation engine against sample-data
```

## Package (Windows installer)

```
pip install pyinstaller
npm run dist       # → release in dist/, installer via electron-builder
```
