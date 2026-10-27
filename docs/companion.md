# The companion

The same build runs in two places. On GitHub Pages it is complete on its own. Self-hosted, a
**companion** at `./companion/` answers too, and the bug reporter sends reports instead of only
saving them. The app finds out which by fetching `companion/capabilities` once (`src/companion.js`).
A 404, an HTML page or no answer at all means there is no companion, so nothing changes.

| | Pages | Self-hosted |
|---|---|---|
| `companion/capabilities` | 404 | `{"protocol":"dat-companion/1","features":["reports"]}` |
| Bug note buttons | Save | Send (the report is still kept locally) |
| Crash screen | Copy | Copy, plus **Send the report** (sends only on a click) |

## What a report sends

`remoteReport()` in `src/bugReports.js` builds the report from allowlists. It never builds one by
removing fields from a fuller object, so a new field is never sent by default. **What will be sent**
in the note shows the exact JSON before the person sends it.

- **The row the report is about.** This is looked up in the model by ref, never read from the screen.
  It holds the Element IDs, type, loadings, and the proposed placement beside the baseline. For a
  driver, that also covers its nodes and the cables on them.
  An assessment row sends its PositionType, ControlGroup and loadings, but not its location.
- **The patch**, from the Report flag in Review changes: the cables moved (ref, from, to) and the
  types, drivers added and drivers deleted, as refs only.
- **Context.** Branch and set IDs, the hub, the mode and the overlay version.
- **The build.** Version, channel, build name and commit.
- **Where it happened.** Screen, hub and counts; the area and dialog names; up to ten refs; the
  times and screens of the last clicks.

It never sends a CSV, the session, or any free text from the screen: no row text, no button
labels and no location names.

![Send, with the payload open](img/companion-send.png)

On Pages the same note offers only Save:

![Pages: Save](img/companion-pages.png)

## Build names

`vite.config.js` stamps every HTML entry with `build-commit`, `build-tree` and `build-name`. The
build name is an adjective and an animal chosen from the tree hash, the same scheme the PS&R tool
uses. A dev build and the prod build it ships as therefore share one name. The badge sits
bottom-right, and on the dev channel (`APP_CHANNEL=dev`) it reads **DEV · name** in red:

![The dev badge](img/companion-dev-badge.png)
