# Refreshing src/catalogue.js

The catalogue is transcribed from the **Driver Specs** page group in Kaizen. It is
static on purpose: this app runs as a sandboxed iframe on GitHub Pages and cannot
reach Kaizen at runtime.

Regenerate with the DataJoin MCP (`kaizen-link`), two calls:

    run_tool('search_pages', {group: "Driver Specs", query: "Wattage",
                              in_body: true, limit: 100})
    run_tool('search_pages', {group: "Driver Specs", query: "Outputs",
                              in_body: true, limit: 100})

Each spec page uses the same block, and the two snippets between them carry every
field the catalogue needs:

    Type: Constant Current    Protocol: DALI 2       Device Type: DT6
    Wattage: 30W              Voltage: 2-55V         Current: 150 - 1400mA
    Addresses: 1              Outputs: 1

Mapping into the catalogue:

| Spec page | Catalogue | DesignDB column |
|---|---|---|
| Wattage | `maxPowerW` | `MaxPower(W)` |
| Voltage (CC) — **top of the range** | `maxFvV` | `NodeMaxForwardVoltage(fV)` |
| Voltage (CV) | `outputV` | `OutputVoltage(V)` |
| Current | `minA` / `maxA` | `CurrentRange` picks one value in the range |
| Outputs | `outputs` | `Parameters` `{<OP.1,…}` |
| Addresses | `addresses` | `BallastCountPerUoM` — the `nCH` in a ref |
| Protocol | `controlType` | `ControlType` |

`psuLimitW` is for DC/DC drivers whose page says "may be limited to NNNW if using
an NNNW Class PSU".

Two cautions.

**Pick the project-123 copy.** Specs are duplicated into each project's own book
(SoloDrive 360/A exists four times). Project 123, *Lighting and Shading
Technology*, is the master. The copies agree today; nothing enforces that, so if
they disagree, 123 wins and the difference is worth reporting.

**Add aliases from the data, not from the page.** DesignDB names parts by product
code — `SLO560S3`, `DL0560S3`, and `SL0240A3` with a zero for the letter O. Find
them with:

    SELECT DISTINCT Name FROM SystemSetElementTypes
    WHERE IsSetDeleted IS NULL AND (Ref LIKE 'ET-CCR-%' OR Ref LIKE 'ET-CVR-%')
