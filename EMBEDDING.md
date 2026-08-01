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
> page is on `kaizen.example.com`, this variable holds **`kaizen.example.com`**.

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
    case 'dat:ready':  sendInit(); break;
    case 'dat:dirty':  unsavedChanges = m.changeCount; break;
    case 'dat:export': receiveExport(m); break;
    case 'dat:error':  showError(m.message); break;
  }
});

function sendInit() {
  frame.contentWindow.postMessage({
    type: 'dat:init',
    version: 1,
    form:  formCsvText,     // raw text, not a File, not base64
    links: linksCsvText,
    focusZone: 'HUB-B1',
    context: { systemSetId: 108835, hubRef: 'p50123', hubLabel: 'HUB-B1' },
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
| `form` | string | yes | Raw **Driver Assignment** CSV text |
| `links` | string | yes | Raw **Links Assignment** CSV text |
| `focusZone` | string | no | Must match the `Pullzone` column exactly |
| `context` | object | no | See below |

### `context`

```js
context: {
  systemSetId: 108835,   // point-in-time token — see §5
  hubRef: 'p50123',      // opaque to the tool; passed through, never parsed
  hubLabel: 'HUB-B1',    // shown in the header so the user can see which hub/set
}
```

`systemSetId` and `hubRef` are the session key (§5). `hubLabel` is display only.

### `focusZone`

The tool opens directly on this Pullzone. If it doesn't match any zone in the
data, the tool lands on the zone list with a dismissible notice — it does **not**
fail. A hub with no drivers yet is a legitimate state and fixing that is what the
tool is for.

Typically you send only that hub's rows, so the model contains one zone and the
"back to zones" button is hidden automatically.

---

## 5. `systemSetId` — resume across a flaky frame

The tool autosaves the whole working session to `localStorage`, keyed:

```
driverassignmenttool.session.v1:<systemSetId>:<hubRef>
```

That key is the whole contract for resume:

- **Same `systemSetId` + same `hubRef`** → returning user is offered
  *"Previous session found · 3 changes · 14:22 — [Resume] [Start fresh]"* over the
  live data. Their work comes back.
- **Different `hubRef`** → different slot. Hub-by-hub posting into the same frame
  never cross-contaminates.
- **Bumped `systemSetId`** → the point in time moved, so the old work is *not*
  offered against new data. This is the point of the token: send a new one
  whenever the upstream design data changes, and stale sessions retire themselves.

Send the same `systemSetId` for the same point in time, and a new one when the
data behind it changes. If you omit `context` entirely, every hub shares one slot
and the resume offer will be wrong.

**Storage caveat:** third-party iframe storage is partitioned per top-level site
in Chrome and blocked outright under Safari ITP and Firefox strict mode. The tool
degrades to "no resume offered" rather than erroring. Don't build anything that
depends on resume working.

**Resume never navigates.** Because your modal is hub-specific, resuming restores
the work but keeps the user on the hub you opened them on.

---

## 6. `dat:export` — getting the result back

Chrome blocks downloads initiated from a sandboxed cross-origin iframe, sometimes
silently, and `navigator.clipboard` needs `allow="clipboard-write"`. So embedded,
both outputs come to you instead:

```js
{ type: 'dat:export', version: 1,
  kind: 'csv' | 'patch',
  filename: 'DriverAssignmentForm-20260801.csv',
  content: '<the whole file as text>' }
```

- **`kind: 'csv'`** — the full Driver Assignment CSV, same columns and row order
  as the one you sent, with `ToEntityRefs` updated. Round-trips losslessly; it can
  be re-imported into the standalone tool.
- **`kind: 'patch'`** — an **ExcelScript / Office Scripts macro**, not data. A
  human pastes it into the Office Scripts editor and runs it against the workbook.
  Receiving it does not close that loop — surface it as copyable text, don't try
  to apply it.

Save it, offer it as a download, POST it upstream — the tool has done its part.

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
