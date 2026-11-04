# The companion

The same build runs in two places. On GitHub Pages it is complete on its own. Self-hosted, a
**companion** at `./companion/` answers too, and the bug reporter sends reports instead of only
saving them. The app finds out which by fetching `companion/capabilities` once (`src/companion.js`).
A 404, an HTML page or no answer at all means there is no companion, so nothing changes.

| | Pages | Self-hosted |
|---|---|---|
| `companion/capabilities` | 404 | `{"protocol":"dat-companion/1","features":["reports","opened","parts"]}` |
| Bug note buttons | Save | Send (the report is still kept locally) |
| Crash screen | Copy | Copy, plus **Send the report** (sends only on a click) |
| Driver parts | the static catalogue | the static catalogue, plus the shared one, which learns from the answers given while filling in driver types |

## What a report sends

`remoteReport()` in `src/bugReports.js` builds the report from allowlists. It never builds one by
removing fields from a fuller object, so a new field is never sent by default. Where is always
recorded and the payload is not shown in the note: allowlists, not a preview, are what keep it safe.

- **The row the report is about.** This is looked up in the model by ref, never read from the screen.
  It holds the Element IDs, type, loadings, and the proposed placement beside the baseline. For a
  driver, that also covers its nodes and the cables on them.
  An assessment row sends its PositionType, ControlGroup and loadings, but not its location.
- **The patch**, from the Report flag in Review changes: the cables moved (ref, from, to) and the
  types, drivers added and drivers deleted, as refs only.
- **The estimate line**, from "Calculation looks wrong" in an estimate's working: the type, count,
  quantity, limit, ControlGroup, row refs, the engine's working figures and the options. No locations.
- **Context.** Branch and set IDs, the hub, the mode and the overlay version.
- **The build.** Version, channel, build name and commit.
- **Where it happened.** Screen, hub and counts; the area and dialog names; up to ten refs; the
  times, screens and areas (`data-debug-id`) of the last clicks. Tag a new surface with a
  `data-debug-id` or a report from it says nothing about where it came from.

It never sends a CSV, the session, or any free text from the screen: no row text, no button
labels and no location names.

![Send](img/companion-send.png)

On Pages the same note offers only Save:

![Pages: Save](img/companion-pages.png)

## Shared driver parts

`GET companion/parts` returns the shared catalogue for the channel (prod and dev are separate).
`POST companion/parts` takes `{part}`, `{vote}`, `{reason}` or `{part, reason}`, and returns the new
list. datajoin stores parts in `dat_parts`: one `observed` row per name, the latest write wins, and
a `confirmed` row (set by hand) outranks it. Votes are per version (`rev`, a hash of the part), and
a reason code per value goes in `dat_part_reasons`. Each row keeps a hash of the sender's IP so one
source can be purged.

A part is datasheet ratings only, never design data: name, code, aliases (matched as substrings, no
regex is ever shared), CC/CV, kind, control type, the numeric ratings. A reason is a part name, a
column and one of three codes. datajoin validates every field against fixed ranges and refuses
anything else.

In the app (`setSharedParts` in `src/catalogue.js`):

- The static catalogue always wins. A shared part whose name matches a static one is an
  **amendment**: once agreed, the editor offers its value beside the datasheet's, never in its place.
- A shared part only fills blanks, never overwrites (`canReplace` is false), and a type filled from
  one has origin **shared**, listed on its own in Review changes so it is checked before the patch.

### Filling in a driver type

There is no share button and no setting. The companion learns from the answers the person gives
anyway (`src/learn.js`), and on Pages the same answers send nothing:

| The person does | Sent |
|---|---|
| Says yes to a family built on another project's part | `{vote: confirmed}` for that part's `rev` |
| Says yes to a family built on a spec page | nothing |
| Keeps a type's own values, as *derated on purpose* or *a different variant* | `{reason}`: the code per value, no values |
| Keeps them because *the datasheet's wrong* | `{part, reason}`: the part, amended with the DesignDB's value |
| Fills in by hand a product no catalogue has | `{part}`, its currents as the range |
| Says "it's a different product" to another project's part | `{vote: rejected}` |

A vote counts once per version, whichever screen it came from. Retaken, with every body checked,
by `node docs/companion-shots.mjs` against a mocked companion.

A part one other person entered still forms a family. Saying yes to it is the second vote:

![A family on another project's part](img/companion-family.png)

A type set aside and kept as it is asks why, per value that differs. *Derated on purpose* is
offered only when its value is lower:

![Why its own values are right](img/companion-reasons.png)

In the type editor, an agreed amendment's value is offered under its field:

![Suggested in the editor](img/companion-editor-suggested.png)

An unchecked one is asked about there instead. The card names whose numbers it asks about (another project's, never this DesignDB's) and puts them beside the datasheet's:

![Check a correction](img/companion-editor-check.png)

## Build names

`vite.config.js` stamps every HTML entry with `build-commit`, `build-tree` and `build-name`. The
build name is an adjective and an animal chosen from the tree hash, the same scheme the PS&R tool
uses. A dev build and the prod build it ships as therefore share one name. The badge sits
bottom-right, and on the dev channel (`APP_CHANNEL=dev`) it reads **DEV · name** in red:

![The dev badge](img/companion-dev-badge.png)
