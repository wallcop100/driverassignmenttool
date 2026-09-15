// The ExcelScript patch emitter.
//
// Nothing here knows what a driver or a panel is. It knows how to find a column
// without hard-coding its number, how to repoint a link end, how to append and
// soft-delete an Element with its cascade, and how to write a layout back - all
// of which is the same work whether the thing being patched is a driver in a hub
// or a module in a panel.
//
// What stays with each tool is what it patches: the ElementTypes columns it
// owns, which rows it decides to write, and the name it signs the script with.
// ---- the ExcelScript patch -------------------------------------------------
// Written to the house rules for DesignDB patch scripts (page 138351):
//
//   * one main(), wrapped in try/catch, nothing hard-coded by column number
//   * used ranges read ONCE, before the loops, never inside them
//   * every lookup guarded: a Ref the workbook has not got logs a warning and is
//     skipped, it does not throw
//   * a flag column is "Y" or cleared; a value is cleared with
//     .clear(ExcelScript.ClearApplyTo.contents), never setValue("")
//   * writing any data column on a row clears that row's IsPropertiesTBC
//   * OMIT first, then CHANGE, then ADD
//
// It deviates in one place, deliberately: the rules ask for a single bulk
// setValues() at the end, and this writes changed cells individually. Writing a
// whole used range back would rewrite every cell of a live workbook to fix a
// handful, and the expensive part - rescanning the sheet per row - is gone
// either way.
const esc = (v) => String(v).replace(/"/g, '\\"');

// Column lookup that can ADD the column. The ten driver attributes arrived with
// Lighting DesignDB V4.6, so a workbook made before it simply has no
// MaxPower(W) column to find - and find() on a missing header throws, taking the
// whole script with it. `add` columns are appended to the header row instead,
// which is what makes onboarding an older workbook a single paste.
export const COL_HELPER = [
  '  // Find a column by header. Columns listed as addable are appended to the',
  '  // header row when the workbook has not got them yet (pre-V4.6 books), and',
  '  // a header this script created is marked so it reads as new in the sheet.',
  '  function columnIndex(ws: ExcelScript.Worksheet, name: string, add: boolean): number {',
  '    const found = ws.getCell(0, 0).getEntireRow().find(name, { completeMatch: true });',
  '    if (found) { return found.getColumnIndex(); }',
  '    if (!add) { throw new Error("Column not found: " + name); }',
  '    const at = ws.getUsedRange().getColumnCount();',
  '    const cell = ws.getCell(0, at);',
  '    cell.setValue(name);',
  '    const f = cell.getFormat().getFont();',
  '    f.setColor("#C00000");',
  '    f.setItalic(true);',
  '    f.setBold(true);',
  '    console.log("Added column " + name + " to " + ws.getName());',
  '    return at;',
  '  }',
  '',
  '  // An electrical value supplied by this script, as against one the design',
  '  // already held. Red italic, not bold: the header carries the bold.',
  '  function setElectrical(cell: ExcelScript.Range, value: number | string) {',
  '    cell.setValue(value);',
  '    const f = cell.getFormat().getFont();',
  '    f.setColor("#C00000");',
  '    f.setItalic(true);',
  '  }',
  '',
  '',
].join('\n');

export const header = (sheet, code, cols, addable = []) => `    const WS_${code} = DB.getWorksheet("${sheet}");\n`
  + cols.map((c) => `    const col_${code}_${c.replace(/[^A-Za-z0-9]/g, '')} = `
    + `columnIndex(WS_${code}, "${c}", ${addable.includes(c)});\n`).join('')
  // read AFTER any column was appended, so the array has it
  + `    const data_${code} = WS_${code}.getUsedRange().getValues();\n`;

export const CLEAR = 'clear(ExcelScript.ClearApplyTo.contents)';
export const json = (rows) => rows.map((r) => `      ${JSON.stringify(r)},`).join('\n');

export function script(body, tool = 'Driver Assignment Tool') {
  return `// Lighting DesignDB patch - ${tool}\n`
    + COL_HELPER
    + 'function main(DB: ExcelScript.Workbook) {\n'
    + '  try {\n'
    + body
    + '    console.log("Patch complete.");\n'
    + '  } catch (e) {\n'
    + '    console.log("Script error: " + e);\n'
    + '    throw e;\n'
    + '  }\n'
    + '}\n';
}


// ---- LinksMap ----
// A logical link can span several LinksMap rows sharing one Ref (a loop serving
// many fittings), told apart by LinkRefRowKey - which the hub CSV does not carry.
// In practice every row of a Ref shares its From end, so patching them all is
// both right and necessary: patching only the first, as a bare find() does,
// leaves the rest pointing at the old driver. The exception is a cable fed from
// two places, whose rows genuinely differ. Those cannot be told apart without
// the row key, so the script checks at run time and skips them with a warning
// rather than collapsing both ends onto one driver.
export const LINK_COLS = ['Ref', 'FromLinkEndContextType', 'FromLinkEndContextRef',
  'FromLinkEndContextParameters', 'ToLinkEndContextRef', 'IsDeleted', 'IsPropertiesTBC'];

export const linkSection = (patches) => `    // --- CHANGE: LinksMap From ends ---\n`
  + `    const linkPatches = [\n${json(patches)}\n    ];\n`
  + `    for (const p of linkPatches) {\n`
  + `      const rows = [];\n`
  + `      for (let i = 1; i < data_X.length; i++) {\n`
  + `        if (String(data_X[i][col_X_Ref]) === p.ref) { rows.push(i); }\n`
  + `      }\n`
  + `      if (rows.length === 0) {\n`
  + `        console.log("WARNING: " + p.ref + " not found in LinksMap - skipped.");\n`
  + `        continue;\n`
  + `      }\n`
  + `      const ends = [];\n`
  + `      for (const i of rows) {\n`
  + `        const end = String(data_X[i][col_X_FromLinkEndContextType]) + "|"\n`
  + `          + String(data_X[i][col_X_FromLinkEndContextRef]) + "|"\n`
  + `          + String(data_X[i][col_X_FromLinkEndContextParameters]);\n`
  + `        if (ends.indexOf(end) === -1) { ends.push(end); }\n`
  + `      }\n`
  + `      if (ends.length > 1) {\n`
  + `        console.log("WARNING: " + p.ref + " has " + rows.length\n`
  + `          + " rows with different From ends (fed from more than one place)."\n`
  + `          + " Skipped - patch it by hand against LinkRefRowKey.");\n`
  + `        continue;\n`
  + `      }\n`
  + `      for (const i of rows) {\n`
  + `        WS_X.getCell(i, col_X_FromLinkEndContextType).setValue(p.type);\n`
  + `        WS_X.getCell(i, col_X_FromLinkEndContextRef).setValue(p.to);\n`
  + `        if (p.node) {\n`
  + `          WS_X.getCell(i, col_X_FromLinkEndContextParameters).setValue("{" + p.node + "}");\n`
  + `        } else {\n`
  + `          WS_X.getCell(i, col_X_FromLinkEndContextParameters).${CLEAR};\n`
  + `        }\n`
  + `        WS_X.getCell(i, col_X_IsPropertiesTBC).${CLEAR};\n`
  + `      }\n`
  + `      console.log("Repointed " + p.ref + " (" + rows.length + " row(s)) at "\n`
  + `        + p.to + (p.node ? " " + p.node : ""));\n`
  + `    }\n\n`;

// ---- Elements ----
// Quantity is left blank where it is 1: the schema assumes 1, and writing it
// adds noise to every row the tool appends.
export const ELEM_COLS = ['Ref', 'Name', 'TypeRef', 'ContextType', 'ContextRef', 'Quantity',
  'IsDeleted', 'IsPropertiesTBC', 'ContextParameters', 'Parameters'];

// ContextParameters and Parameters are how a hub layout is kept: where an item
// sits inside its hub, and how big the hub came out. Addable, because a workbook
// that has never held a layout has no reason to have the columns.
export const LAYOUT_COLS = ['ContextParameters', 'Parameters'];

// Soft-delete plus the cascade the house rules require. The LinksMap half is the
// point: this tool only ever sees SECONDARY POWER cables, so a driver's mains
// feed and its control link are invisible to it and nothing else would catch
// them. Deleting the Element without them leaves links pointing at a deleted row.
//
// A cable this same patch repoints is exempt - it is not orphaned, it has been
// moved, and OMIT runs before CHANGE so the cascade would otherwise delete the
// row the repoint is about to rewrite.
export const deleteSection = (refs, keepLinks) => `    // --- OMIT: Elements, with cascade ---\n`
  + `    const deletedRefs = [\n${json(refs)}\n    ];\n`
  + `    const repointed = [\n${json(keepLinks)}\n    ];\n`
  + `    for (const ref of deletedRefs) {\n`
  + `      let row = -1;\n`
  + `      for (let i = 1; i < data_E.length; i++) {\n`
  + `        if (String(data_E[i][col_E_Ref]) === ref) { row = i; break; }\n`
  + `      }\n`
  + `      if (row === -1) {\n`
  + `        console.log("WARNING: " + ref + " not found in Elements - skipped.");\n`
  + `        continue;\n`
  + `      }\n`
  + `      WS_E.getCell(row, col_E_IsDeleted).setValue("Y");\n`
  + `      // child Elements, recursively. A driver's children are normally\n`
  + `      // generated _EE rows that never reach this sheet, so this usually does\n`
  + `      // nothing - but it costs one pass and catches a real child if there is one.\n`
  + `      let frontier = [ref];\n`
  + `      while (frontier.length > 0) {\n`
  + `        const parent = frontier.pop();\n`
  + `        for (let i = 1; i < data_E.length; i++) {\n`
  + `          if (String(data_E[i][col_E_ContextType]) === "Element"\n`
  + `            && String(data_E[i][col_E_ContextRef]) === parent\n`
  + `            && String(data_E[i][col_E_IsDeleted]) !== "Y") {\n`
  + `            WS_E.getCell(i, col_E_IsDeleted).setValue("Y");\n`
  + `            frontier.push(String(data_E[i][col_E_Ref]));\n`
  + `            console.log("  cascaded to child Element " + String(data_E[i][col_E_Ref]));\n`
  + `          }\n`
  + `        }\n`
  + `      }\n`
  + `      // every link touching it, either end. A cable this patch is moving is\n`
  + `      // not orphaned, so it is left for the CHANGE section.\n`
  + `      for (let i = 1; i < data_X.length; i++) {\n`
  + `        if (String(data_X[i][col_X_IsDeleted]) === "Y") { continue; }\n`
  + `        if (repointed.indexOf(String(data_X[i][col_X_Ref])) !== -1) { continue; }\n`
  + `        if (String(data_X[i][col_X_FromLinkEndContextRef]) === ref\n`
  + `          || String(data_X[i][col_X_ToLinkEndContextRef]) === ref) {\n`
  + `          WS_X.getCell(i, col_X_IsDeleted).setValue("Y");\n`
  + `          console.log("  cascaded to link " + String(data_X[i][col_X_Ref]));\n`
  + `        }\n`
  + `      }\n`
  + `      console.log("Soft-deleted " + ref + " with cascade.");\n`
  + `    }\n\n`;

// Where each item sits, which hub it belongs to, and how big each hub came out.
// A move writes a coordinate; a split or a join writes a parent as well. The
// hub's own size goes on the INSTANCE, not the type: every hub in the space
// requirement drawings is a different size, and writing it to ET-PSU-ENC-T5
// would claim every enclosure of that type matches this one.
export const layoutSection = (items, hubs) => `    // --- CHANGE: hub layout ---\n`
  + `    const layout = [\n${json(items)}\n    ];\n`
  + `    for (const it of layout) {\n`
  + `      let row = -1;\n`
  + `      for (let i = 1; i < data_E.length; i++) {\n`
  + `        if (String(data_E[i][col_E_Ref]) === it.ref) { row = i; break; }\n`
  + `      }\n`
  + `      if (row === -1) {\n`
  + `        console.log("WARNING: " + it.ref + " not found in Elements - skipped.");\n`
  + `        continue;\n`
  + `      }\n`
  + `      WS_E.getCell(row, col_E_ContextParameters).setValue(it.at);\n`
  + `      if (it.hub) {\n`
  + `        WS_E.getCell(row, col_E_ContextType).setValue(it.hubType);\n`
  + `        WS_E.getCell(row, col_E_ContextRef).setValue(it.hub);\n`
  + `      }\n`
  + `      WS_E.getCell(row, col_E_IsPropertiesTBC).${CLEAR};\n`
  + `      console.log("Placed " + it.ref + " at " + it.at + (it.hub ? " in " + it.hub : ""));\n`
  + `    }\n`
  + `    const hubSizes = [\n${json(hubs)}\n    ];\n`
  + `    for (const h of hubSizes) {\n`
  + `      let row = -1;\n`
  + `      for (let i = 1; i < data_E.length; i++) {\n`
  + `        if (String(data_E[i][col_E_Ref]) === h.ref) { row = i; break; }\n`
  + `      }\n`
  + `      if (row === -1) {\n`
  + `        console.log("WARNING: hub " + h.ref + " not found in Elements - size not written.");\n`
  + `        continue;\n`
  + `      }\n`
  + `      WS_E.getCell(row, col_E_Parameters).setValue(h.params);\n`
  + `      console.log("Hub " + h.ref + " comes to " + h.params);\n`
  + `    }\n\n`;

export const addSection = (adds) => `    // --- ADD: Elements ---\n`
  + `    const newElements = [\n${json(adds)}\n    ];\n`
  + `    let row_E = data_E.length;\n`
  + `    for (const el of newElements) {\n`
  + `      WS_E.getCell(row_E, col_E_Ref).setValue(el.ref);\n`
  + `      if (el.name) { WS_E.getCell(row_E, col_E_Name).setValue(el.name); }\n`
  + `      WS_E.getCell(row_E, col_E_TypeRef).setValue(el.typeRef);\n`
  + `      WS_E.getCell(row_E, col_E_ContextType).setValue(el.contextType);\n`
  + `      WS_E.getCell(row_E, col_E_ContextRef).setValue(el.contextRef);\n`
  + `      if (el.quantity !== 1) { WS_E.getCell(row_E, col_E_Quantity).setValue(el.quantity); }\n`
  + `      if (el.note) { console.log("NOTE: " + el.ref + " - " + el.note); }\n`
  + `      row_E++;\n`
  + `      console.log("Appended " + el.ref + " (" + el.typeRef + ") on " + el.contextRef);\n`
  + `    }\n`
  + `    console.log("Every appended row carries the placeholder Ref. "\n`
  + `      + "Elements.Ref must be unique - give each one a real Ref, and repoint its cables.");\n\n`;

// Presets worth patching: a correction to a type that really exists, or an
// invented type something actually uses. A preset typed and then abandoned is
// not a change to the workbook.
// ':' is banned inside a node name, and a node written that way is referenced
// from LinksMap rows belonging to hubs this session has never opened. So the
// sweep runs against the whole sheet rather than this hub's cables: it is a
// character swap that cannot change which node a cable is on.
export const sweepSection = () => `    // --- CHANGE: banned ':' in node names ---\n`
  + `    let swept = 0;\n`
  + `    for (let i = 1; i < data_X.length; i++) {\n`
  + `      const p = String(data_X[i][col_X_FromLinkEndContextParameters]);\n`
  + `      if (p.indexOf(":") === -1) { continue; }\n`
  + `      WS_X.getCell(i, col_X_FromLinkEndContextParameters).setValue(p.split(":").join("-"));\n`
  + `      swept++;\n`
  + `    }\n`
  + `    console.log("Replaced ':' with '-' in " + swept + " LinksMap node reference(s).");\n\n`;

