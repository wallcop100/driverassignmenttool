# Embedding the Driver Assignment Tool

For the developer building the **host** side. The tool runs in an iframe, gets
its two CSVs over `postMessage`, opens straight on one PSU-hub, and hands
exports back the same way. It makes no network calls of its own and has no
backend.

Everything here is the tool's external interface. It is versioned; `version: 1`
is what this build speaks.

---

## 1. Configure the allowlist (one-time, before anything works)

The tool refuses to talk to an origin it hasn't been built to trust. Set the
GitHub repo variable **`ALLOWED_PARENT_ORIGINS`** to the origin of the **page
that embeds the tool** — comma-separated, no trailing slash — then redeploy:

```
https://designdb.example.com,https://staging.designdb.example.com
```

> **Not the tool's own origin.** This answers "who is allowed to embed me", not
> "where do I live". If the tool is on `wallcop100.github.io` and the design
> page is on `example.com`, this variable holds **`example.com`**.

Vite inlines the value at **build time**, so setting the variable does nothing
until the deploy workflow runs again. Set it first, then re-run the workflow.

Unset means embed mode is off — the iframe will show
*"This tool was opened without a recognised host."* If you see that message,
this step is why.

---

## 2. Render the iframe

```html
<iframe
  src="https://<pages-host>/driverassignmenttool/api/?parentOrigin=https%3A%2F%2Fdesigndb.example.com"
  width="900" height="700"
  allow="clipboard-write">
</iframe>
```

- **`/api/`** is the embed entry. The root `/` is the standalone drop-two-CSVs
  page — don't point at it.
- **`parentOrigin`** is your own origin, URL-encoded. It solves a chicken-and-egg:
  the child sends the first message and `postMessage` needs a `targetOrigin`.
  The tool validates this against the allowlist above and then uses it as the
  only origin it will ever post to or accept from.
- **Size:** the layout is tuned for **900 × 700**. It stays usable smaller
  (breakpoint at 900px collapses the header), but below ~600px wide the driver
  grid gets cramped.
- **Sandboxing:** if you set `sandbox`, include `allow-scripts allow-same-origin`.
  Do **not** rely on `allow-downloads` — see §6, exports come back to you instead.
- Don't put CSV data in the URL. It works on demo data and dies on real data.

---

## 3. Handshake

```
child  →  dat:ready          (after React mounts — NOT iframe.onload)
host   →  dat:types          (driver type library — optional, but send it FIRST)
host   →  dat:init           (the payload)
child  →  dat:dirty          (0, then on every change)
child  →  dat:export         (when the user exports)
```

**Wait for `dat:ready`.** `iframe.onload` fires before the app has mounted a
message listener; anything you post before `dat:ready` is dropped.

```js
const frame = document.getElementById('dat');
const CHILD_ORIGIN = 'https://<pages-host>';

window.addEventListener('message', (e) => {
  if (e.origin !== CHILD_ORIGIN) return;          // always check
  if (e.source !== frame.contentWindow) return;
  const m = e.data;
  if (!m || typeof m !== 'object') return;

  switch (m.type) {
    case 'dat:ready':  sendTypes(); sendInit(); break;   // types first
    case 'dat:dirty':  unsavedChanges = m.changeCount; break;   // label only — do not block close
    case 'dat:export': receiveExport(m); break;
    case 'dat:error':  showError(m.message); break;
  }
});

function sendTypes() {
  frame.contentWindow.postMessage({
    type: 'dat:types',
    version: 1,
    types: typeLibraryCsvText,   // one library for the whole page — see §4a
  }, CHILD_ORIGIN);
}

function sendInit() {
  frame.contentWindow.postMessage({
    type: 'dat:init',
    version: 1,
    form:  formCsvText,     // raw text, not a File, not base64
    links: linksCsvText,
    focusZone: 'HUB-B1',
    context: { branchId: 10470, systemSetId: 108835, hubRef: 'p50123', hubLabel: 'HUB-B1' },
  }, CHILD_ORIGIN);         // never '*'
}
```

You may send `dat:init` again later (e.g. the user switches hub in your UI
without reloading the frame) — it fully replaces the model.

---

## 4. `dat:init` — the payload

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | `'dat:init'` | yes | |
| `version` | `1` | yes | Mismatch → the frame renders an explicit error, not a guess |
| `form` | string | no | Raw **Driver Assignment** CSV text. Absent or empty for a hub with no drivers yet |
| `links` | string | see note | Raw **Links Assignment** CSV text |
| `assessment` | string | see note | Raw **requirement assessment** CSV text, for a hub with no cables |
| `focusZone` | string | no | Must match the `Pullzone` column exactly |
| `context` | object | no | See below |

**`links` or `assessment` — at least one.** Which one you send says which mode
the hub is in, and the tool reaches the same conclusion independently from what
arrives (`detectMode()`), so the two halves agree:

| Sent | Mode | The hub is |
|---|---|---|
| `links` + `form` | assign | designed: cables and drivers both exist |
| `links`, no `form` | size | cabled, but nothing to plug them into yet |
| `assessment`, no `links` | estimate | at tender: Positions only, nothing to assign |

A `dat:init` carrying neither is dropped as `missing links CSV`. A links CSV with
a header and no data rows is **not** an error — it means the hub has no cables,
which is the estimate's case, so send the assessment alongside it or instead.

### The assessment CSV

Fittings rolled up per secondary-power destination — one row per hub +
ControlGroup + fitting type. A row is a *quantity*, not a cable, so the tool
divides it across drivers.

```csv
"Link_SecondaryPowerRef","LocationName","ControlTypeRef","ControlGrouptext","PositionTypeRef","SumQuantity","CC/CV","CV_Voltage","CC_Current","SumVf","SumPower"
"P50001","Study","DALI","L102-H-03","B02w","2","CC","","0.3","70","23.6"
```

`Link_SecondaryPowerRef` is the PSU-HUB **Position Ref**, while `Pullzone`
elsewhere is `COALESCE(ExtRef, Ref)` — the overlay resolves the label rather
than assuming they match. `SumQuantity` may be fractional: it is the type's UoM,
so metres for tape. Rows whose `CC/CV` is neither `CC` nor `CV` are provisions
and are left out.

### `context`

```js
context: {
  branchId:    10470,    // which branch the design belongs to — see §5
  systemSetId: 108835,   // point-in-time token, sequential within the branch
  hubRef:      'p50123', // opaque to the tool; passed through, never parsed
  hubLabel:    'HUB-B1', // shown in the header so the user can see which hub/set
}
```

`branchId` + `systemSetId` + `hubRef` are the session key (§5). `hubLabel` is
display only. **Send all three of the first three** — they are what makes resume
and the all-hubs patch work, and omitting any one of them degrades both.

---

## 4a. `dat:types` — the driver type library

The per-hub export names an `ElementTypeRef` per driver but leaves
`Driver Restrictions` blank. Without the ratings the tool treats every driver as
**undetermined**: capacity is never checked, cables show as "nowhere to go" with
"no matching driver type in inventory", and Add Driver has nothing to describe.

Send the type library once and the tool joins it on `ElementTypeRef`.

```js
{ type: 'dat:types', version: 1, types: '<raw type-library CSV text>' }
```

**Send it before `dat:init`.** `postMessage` preserves order from a single
source, so posting them in sequence is sufficient — there is no ack to wait for.
Arriving after `dat:init` still works, but only while the user has made no
changes yet; once there are edits the tool keeps them and tells the user to
reopen the hub rather than rebuilding underneath them.

It is **optional**. Omit it and behaviour is exactly as it is today.

### Where to put it

One block for the whole page, not one per hub — the library is identical for
every button, so duplicating it per hub is pure page weight:

```html
<!-- once per page -->
<script type="text/plain" id="dat_types">…type library CSV…</script>

<!-- per hub, as now -->
<script type="text/plain" id="datf_P50003">…</script>
<script type="text/plain" id="datl_P50003">…</script>
```

### Columns

Required: **`ElementTypeRef`**. Everything else is read defensively.

| Column | Used for |
|---|---|
| `ElementTypeRef` | the join key against the hub rows |
| `ElementTypeName` | which part it is — matched against the datasheet catalogue |
| `MaxPower(W)`, `CurrentRange`, `OutputVoltage(V)` | the driver's rating |
| `NodeMaxPower(W)`, `NodeMaxForwardVoltage(fV)`, `NodeCurrent` | per-output limits |
| `BallastCountPerUoM` | DALI addresses — the `nCH` in a ref |
| `Channels` | output count, if one row per type |
| `ControlType` | `DALI` / `PHASE` / `Local` |
| `Driver Restrictions` | **legacy** — the composed rating, `300W \| 0.3A` (CC) or `180W \| 24V` (CV) |
| `Node Restrictions` | **legacy** — per-node `<n>W` / `<n>fV` limits |
| `Node` | node name, if one row per type+node |

**State the columns rather than composing them.** The composed
`Driver Restrictions` string is order-dependent, and a driver-level
`MaxForwardVoltage(fV)` landing between the watts and the rating reads as
`50W | 55fV | 0.35A`, which parses as **CC/CV undeclared** — the type then
matches no cable and cannot be sized against. The explicit columns win wherever
they are present; the composed form is still read, so an older host keeps
working.

Note `Channels` and `BallastCountPerUoM` are different numbers. Outputs are what
cables land on; addresses are what the ref's `nCH` counts. A SoloDrive 560/A is
two outputs on **one** address, which is exactly what separates it from a
DualDrive 560/A.

Two row shapes are accepted, whichever your exporter produces:

```csv
# one row per type+node — node limits can differ per channel
ElementTypeRef,Node,Driver Restrictions,Node Restrictions
ET-CVR-D-24-2CH-01,OP.1,180W | 24V,90W
ET-CVR-D-24-2CH-01,OP.2,180W | 24V,90W

# one row per type — nodes are generated as OP.1…OP.n
ElementTypeRef,Channels,Driver Restrictions
ET-CVR-D-24-2CH-01,2,180W | 24V

# stated outright, which is what DJ 101681 V1.4 sends
ElementTypeRef,ElementTypeName,MaxPower(W),CurrentRange,NodeMaxForwardVoltage(fV),BallastCountPerUoM,Channels
ET-CCR-D-350-2CH-01,EldoLED DUALDrive 560/A at 350mA,50,0.35,55,2,2
```

`Channels` is also read as `Nodes`, `NodeCount` or `ChannelCount`; absent, the
type gets one node.

### Two effects worth expecting

1. **Add Driver lists the whole library**, not just the types the hub already
   contains — so a hub can be given a type it does not currently have. That is
   the fix for "no matching driver type in inventory".
2. **Validation starts doing real work.** Drivers that were "undetermined" now
   have declared capacity, so genuine overload and CC/CV mismatches will surface
   where previously everything was a benign warning. Expect new errors on
   existing designs; they were always there, just unverifiable.

If a hub row *does* state its own `Driver Restrictions`, that wins — an explicit
instance value is treated as a deliberate override, and the library only fills
blanks. This is also why adding a library can never change how standalone data
behaves.

---

### `focusZone`

The tool opens directly on this Pullzone. If it doesn't match any zone in the
data, the tool lands on the zone list with a dismissible notice — it does **not**
fail. A hub with no drivers yet is a legitimate state and fixing that is what the
tool is for.

Typically you send only that hub's rows, so the model contains one zone and the
"back to zones" button is hidden automatically.

---

## 5. `branchId` + `systemSetId` — resume across a flaky frame

The tool autosaves the whole working session to `localStorage`, keyed:

```
driverassignmenttool.session.v1:<branchId>:<systemSetId>:<hubRef>
```

That key is the whole contract for resume:

- **Same three** → **the work comes back silently.** Embedded, the tool does not
  ask; a flaky frame means returning to your own work is the expected outcome,
  not a question. A **"Reset to current set"** button in the toolbar discards the
  saved work and reloads exactly what you posted.
- **Different `hubRef`** → different slot. Hub-by-hub posting into the same frame
  never cross-contaminates.
- **Higher `systemSetId`, same `branchId`** → every stored session for that
  branch below the new id is **deleted**. Sets are sequential, so a newer one
  supersedes the older ones and the tool cleans up after itself.
- **Different `branchId`** → untouched. Branches never evict each other.

### How to fill in `branchId`

Send the id of the branch the design belongs to — whatever your system already
calls it, as a plain number or string. The tool never parses it; it only compares
it for equality and groups sessions by it.

Two things depend on you sending it:

1. **Eviction is scoped.** Without `branchId` every branch shares one namespace,
   so opening a newer set in branch A would silently wipe unsaved work in
   branch B.
2. **The all-hubs patch.** §6 — the tool gathers every stored hub in the current
   `branchId` + `systemSetId`. If branch is missing, that set is wrong.

`systemSetId` must increase as the design data moves forward — that ordering is
what the eviction relies on. A non-numeric value disables eviction (the tool
won't guess an order and won't delete what it can't compare), but resume still
works.

**Storage caveat:** third-party iframe storage is partitioned per top-level site
in Chrome and blocked outright under Safari ITP and Firefox strict mode. The tool
degrades to "no resume, no all-hubs patch" rather than erroring. Don't build
anything that depends on either working.

**Resume never navigates.** Because your modal is hub-specific, resuming restores
the work but keeps the user on the hub you opened them on.

---

## 6. `dat:export` — getting the result back

Chrome blocks downloads initiated from a sandboxed cross-origin iframe, sometimes
silently, and `navigator.clipboard` needs `allow="clipboard-write"`. So embedded,
the output comes to you instead:

```js
{ type: 'dat:export', version: 1,
  kind: 'patch',
  filename: 'DriverAssignmentPatch.osts',
  content: '<the ExcelScript source>' }
```

**Embedded, `kind` is always `'patch'`.** The CSV export is hidden in this mode —
that format can't be ingested back into the workbook, so offering it would only
produce a file with nowhere to go. The standalone page still exports CSV; only
the embedded UI drops it.

The patch is an **ExcelScript / Office Scripts macro**, not data. A human pastes
it into the Office Scripts editor and runs it against the workbook. Receiving it
does not close that loop — surface it as copyable text, don't try to apply it.

### Patching every hub at once

The Review dialog offers **"Patch all hubs (N)"** whenever more than one hub of
the current `branchId` + `systemSetId` has saved work. It emits a single
`dat:export` covering all of them — one script, one paste, rather than one per
hub. Handle it exactly like the single-hub patch; only the size differs.

This is read straight from the tool's own storage, which is why §5's
`branchId` matters: it's what scopes "all hubs" to the right set.

---

## 7. `dat:dirty` — intercepting close

```js
{ type: 'dat:dirty', version: 1, changeCount: 3 }
```

Fires on every assignment change (and once with `0` on load). It's the same count
the tool shows on its own *Review changes (N)* button. Use it to warn before
closing the modal.

---

## 8. `dat:error`

```js
{ type: 'dat:error', version: 1, message: 'Driver Assignment CSV: missing column(s): Node' }
```

Sent when a payload can't be parsed. The tool also shows the message in-frame, so
a blank iframe is never the failure mode. Common causes are in §9.

---

## 9. The CSV data

Both are the standard DataJoin exports. Send them **as raw text**, exactly as
exported — including the UTF-8 BOM if present, that's handled.

### Driver Assignment CSV (`form`)

Required columns: **`ElementRef`**, **`Node`**. Everything else is read
defensively, so extra columns are fine and dropping optional ones won't break.

Columns actually used:

| Column | Used for |
|---|---|
| `Pullzone` | zone/hub grouping — must match `focusZone` |
| `ElementRef` | driver identity (one driver, one row per node) |
| `Node` | node name; `ElementRef`+`Node` must be unique |
| `ElementTypeRef` | driver type → the "add a driver" catalogue |
| `ParentElementRef` | passthrough |
| `Driver Restrictions` | parsed as `<W>W \| <value><A\|V>`, e.g. `100W \| 0.7A` (CC) or `150W \| 24V` (CV) |
| `Node Restrictions` | parsed for `<n>W` and `<n>fV` limits |
| `ToEntityType`, `ToEntityRefs` | the existing assignment (comma-separated refs) |
| `ControlGroup` | passthrough |

### Links Assignment CSV (`links`)

Required column: **`LinkRef`** (must be unique).

| Column | Used for |
|---|---|
| `PullZone` | zone/hub grouping — note the capital Z, unlike the form CSV |
| `LinkRef` | cable identity |
| `LinkTypeRef` | type matching |
| `LinkSumPower(W)`, `LinkCurrent`, `LinkVoltage(V)`, `LinkForwardVoltage(Vf)` | capacity and validation |
| `SecondaryPowerType` | `CC` or `CV` |
| `ControlGroupText` | grouping and distribute |
| `ToLocationName`, `PositionType`, `ThreadCount`, `ControlType` | labels and filters |

**Send these values as exported. Do not recompute them.** Loads, voltages and
forward voltages come from an upstream power-flow model; a second implementation
will drift from the first, silently. The tool parses, it does not compute.

### Filtering per hub

Filter both files to the hub's rows — `Pullzone` in the form CSV, `PullZone` in
the links CSV. The tool only ever assigns a cable to a driver in the same zone,
so sending extra zones is safe but pointless; sending a hub's links without its
drivers just shows every cable as unassigned, which is a valid state.

---

## 10. Testing without the host

`public/harness.html` is a working host, in ~120 lines. `npm run dev`, then open
<http://localhost:5173/harness.html>. It does the full handshake against the demo
data with editable `focusZone` / `systemSetId` / `hubRef` / `version`, an iframe
size toggle, and a log of every child→host message. Read it as the reference
implementation of §3.

---

## 11. Checklist

- [ ] `ALLOWED_PARENT_ORIGINS` set to your origin, redeployed
- [ ] iframe points at `/api/`, with `parentOrigin` URL-encoded
- [ ] you wait for `dat:ready` before sending `dat:init`
- [ ] you check `e.origin` on every message, and never post to `'*'`
- [ ] `context.systemSetId` changes when the upstream data does
- [ ] `context.hubRef` is unique per hub
- [ ] you handle `dat:export` for both `csv` and `patch`
- [ ] you handle `dat:error` and `dat:dirty`
