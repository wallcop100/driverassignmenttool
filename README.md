# Driver Assignment Tool

Driver sizing and assignment for the Lighting DesignDB secondary-power workflow.
A **static, client-side React app** — CSV parsing, the DriverHealthCheck
validation engine, sizing and export all run in the browser
([src/engine.js](src/engine.js)). No server, no backend. Embedded, the host is
DJ 101681 (see [EMBEDDING.md](EMBEDDING.md) and
[sysex-overlay-DJ101681.sql](sysex-overlay-DJ101681.sql)).

## Three modes

The tool works out which one it is in from the data, not from which file you
dropped — `detectMode()` in [src/engine.js](src/engine.js). A hub with drivers
but no cables is refused with a message naming the file that would fix it.

| | Given | It does | Output |
|---|---|---|---|
| **Assign** | cables + drivers | place cables on driver outputs, validate | LinksMap patch, CSV |
| **Size** | cables, no drivers | work out the drivers, then place the cables | as above, plus the drivers |
| **Estimate** | neither — Positions only | count the drivers from the fittings | Elements rows, CSV |

**Estimate** is the tender case. There are no cables to assign, so the input is
a requirement assessment: fittings rolled up per secondary-power destination
(the job DJ 100053 does, computed in the overlay from `{{>CalculatedPositions}}`).
A row is a quantity of fittings rather than a cable, so it divides freely across
drivers and the count is arithmetic: fittings per output is the node's forward
voltage over one fitting's, per driver is that times the outputs, capped by
watts. Constraints on that page make the answer deliberately looser — see
`planFromRequirements`.

## The driver catalogue

[src/catalogue.js](src/catalogue.js) holds 34 parts transcribed from the Driver
Specs page group. The ElementTypes library states a max power for about 4% of
driver types, so most of the time the tool is asked to size a driver whose
ratings nobody wrote down — but the type's `Name` almost always says which part
it is. Matching is by model token, because the names are free text
(`LINDrive`, `SLO360/A`, `SL0240A3` with a zero for the letter O).
[REFRESH-catalogue.md](REFRESH-catalogue.md) says how to regenerate it.

## Run (dev)

```
npm install
npm run dev
```

Drop CSVs on the import screen — the two DataJoin exports, or a Links CSV with
the driver type library, or a requirement assessment with the library. A
previously exported Driver Assignment CSV can be re-imported to resume, and the
faint dot in the card corner loads the bundled demo.

## Screens

`node docs/screens.mjs` renders each surface to standalone HTML in `docs/`,
using the real demo data and the app's own stylesheet, so the screenshots in the
docs can be retaken in one pass after a UI change.

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

```
node docs/screens.mjs    # -> docs/*.html
node docs/shoot.mjs      # -> docs/img/*.png
```

Capture needs playwright, which is a **local tool, not a dependency of this
repo** — it is not in `package.json`, because 200MB of browser has no business
in the install for a static app. Set it up where you need it:

```
npm i --no-save playwright && npx playwright install chromium
sudo apt-get install -y libxkbcommon0     # Debian/Ubuntu, incl. Raspberry Pi
```

### Estimate

A hub with Positions and no cables. The count is per hub, each line says which
limit bound it, and the constraints along the top make the answer looser.

![Driver estimate](img/estimate.png)

### Driver types

What the design actually contains comes first; everything we brought to it —
types invented here, and datasheet parts nothing uses — folds away under a count.
Grouping by part is what makes a wrong rating obvious: the flagged rows are types
whose stated wattage disagrees with the spec page.

A type that is in the DesignDB always shows **the DesignDB's own numbers**. A
preset on it appears as a pending change beneath, never in place of them, so it
is never unclear which side a number came from.

![Driver types](img/driver-types.png)
