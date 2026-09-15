// The hub space layout as an ExcelScript patch.
//
// Four things can be written, and every one is MERGED into the cell the workbook
// already holds rather than written over it, because each of these cells can
// carry other Parameter Syntax flavours beside the one being set:
//
//   ElementTypes.Parameters     [w,h,d]          how big a driver type is
//   Elements.ContextParameters  [x,y,z]<bay>     where a driver sits in its hub
//   the hub row's Parameters    [[w,h,d]]<1,2>   how big the hub came out
//   a separated bay             an ET-PSU-ENC Element holding its drivers
//
// The merge runs in the script against the live cell. A size already in the
// workbook is therefore seen at patch time even when the tool was never sent it,
// and writing the same size again changes nothing.
import { script, header, json, CLEAR } from '../core/patch.js';
import { PLACEHOLDER_REF, outRef } from '../core/csv.js';
import { parseParams, formatParams } from '../core/params.js';

// One source for the merge. TypeScript, because Office Scripts refuse an untyped
// function; the tests strip the annotations and run this same text.
// Read by depth, as core/params.js reads it: a [size] inside a <space> belongs to
// the space, so replacing the entity's size must never reach into one.
export const MERGE_TS = `    const closeAt = (s: string, i: number, open: string): number => {
      if (open === "[[") { const j = s.indexOf("]]", i + 2); return j < 0 ? -1 : j + 2; }
      if (open === "[") { const j = s.indexOf("]", i + 1); return j < 0 ? -1 : j + 1; }
      if (open === "{") {
        let d = 0;
        for (let k = i; k < s.length; k++) { if (s[k] === "{") { d++; } else if (s[k] === "}") { d--; if (d === 0) { return k + 1; } } }
        return -1;
      }
      for (let k = i + 1; k < s.length; k++) {
        if (s[k] === "[") { const inner = closeAt(s, k, s[k + 1] === "[" ? "[[" : "["); if (inner < 0) { return -1; } k = inner - 1; }
        else if (s[k] === "(") { const j = s.indexOf(")", k + 1); if (j < 0) { return -1; } k = j; }
        else if (s[k] === ">") { return k + 1; }
      }
      return -1;
    };
    const mergeFlavour = (current: string, flavour: string, value: string): string => {
      const s = String(current === null || current === undefined ? "" : current);
      let out = "";
      let done = false;
      let i = 0;
      while (i < s.length) {
        const c = s[i];
        const open = c === "[" ? (s[i + 1] === "[" ? "[[" : "[") : (c === "{" || c === "<" ? c : "");
        const end = open === "" ? -1 : closeAt(s, i, open);
        if (end < 0) { out += c; i++; continue; }
        const kind = open === "[[" ? "capacity" : open === "[" ? "size" : open === "{" ? "nodes" : "spaces";
        if (kind === flavour && !done) { done = true; } else { out += s.slice(i, end); }
        i = end;
      }
      out = out.trim();
      return value ? value + out : out;
    };
`;

// Row lookup built once from the used range, never a scan per item (page 138351).
const rowMap = (code) => `    const rowOf_${code} = new Map<string, number>();\n`
  + `    for (let i = 1; i < data_${code}.length; i++) { rowOf_${code}.set(String(data_${code}[i][col_${code}_Ref]), i); }\n`;

const typeSizeSection = (types) => `    // --- CHANGE: ElementTypes sizes ---\n`
  + `    const typeSizes = [\n${json(types)}\n    ];\n`
  + `    for (const t of typeSizes) {\n`
  + `      const row = rowOf_ET.get(t.ref);\n`
  + `      if (row === undefined) { console.log("WARNING: type " + t.ref + " not found in ElementTypes - size not written."); continue; }\n`
  + `      const was = String(data_ET[row][col_ET_Parameters]);\n`
  + `      let next = t.size ? mergeFlavour(was, "size", t.size) : was;\n`
  // a wrapper's parts, as named spaces with sizes and positions (page 1410108)
  + `      if (t.setSpaces) { next = mergeFlavour(next, "spaces", t.spaces); }\n`
  + `      if (next === was) { console.log("Type " + t.ref + " already " + next); continue; }\n`
  + `      WS_ET.getCell(row, col_ET_Parameters).setValue(next);\n`
  + `      WS_ET.getCell(row, col_ET_IsPropertiesTBC).${CLEAR};\n`
  + `      console.log("Type " + t.ref + ": " + was + " -> " + next);\n`
  + `    }\n\n`;

// Last, after every write that clears IsPropertiesTBC on the rows it touched,
// so a flag somebody set here is not undone by the patch that carries it.
const tbcSection = (code, rows) => `    // --- CHANGE: TBC flags on ${code === 'ET' ? 'ElementTypes' : 'Elements'} ---\n`
  + `    const tbc_${code} = [\n${json(rows)}\n    ];\n`
  + `    for (const f of tbc_${code}) {\n`
  + `      const row = rowOf_${code}.get(f.ref);\n`
  + `      if (row === undefined) { console.log("WARNING: " + f.ref + " not found - TBC flags not written."); continue; }\n`
  + `      const tbc = WS_${code}.getCell(row, col_${code}_IsTBC);\n`
  + `      const props = WS_${code}.getCell(row, col_${code}_IsPropertiesTBC);\n`
  + `      if (f.isTBC) { tbc.setValue("Y"); } else { tbc.${CLEAR}; }\n`
  + `      if (f.isPropertiesTBC) { props.setValue("Y"); } else { props.${CLEAR}; }\n`
  + `      console.log(f.ref + ": IsTBC " + (f.isTBC ? "Y" : "-") + ", IsPropertiesTBC " + (f.isPropertiesTBC ? "Y" : "-"));\n`
  + `    }\n\n`;

const elementSection = (rows) => `    // --- CHANGE: where each driver sits ---\n`
  + `    const placed = [\n${json(rows)}\n    ];\n`
  + `    for (const it of placed) {\n`
  + `      const row = rowOf_E.get(it.ref);\n`
  + `      if (row === undefined) { console.log("WARNING: " + it.ref + " not found in Elements - skipped."); continue; }\n`
  + `      const was = String(data_E[row][col_E_ContextParameters]);\n`
  + `      const next = mergeFlavour(mergeFlavour(was, "spaces", it.spaces), "size", it.xyz);\n`
  // back in the tray: the placement comes off, and an emptied cell is cleared
  + `      if (next !== was) { if (next === "") { WS_E.getCell(row, col_E_ContextParameters).${CLEAR}; } else { WS_E.getCell(row, col_E_ContextParameters).setValue(next); } }\n`
  // what it sits in: the hub, or its piece's enclosure Element
  + `      if (it.contextRef) {\n`
  + `        WS_E.getCell(row, col_E_ContextType).setValue(it.contextType);\n`
  + `        WS_E.getCell(row, col_E_ContextRef).setValue(it.contextRef);\n`
  + `      }\n`
  // turned: the Element states its as-placed size over its type's
  // turned: the Element states its as-placed size; junction boxes are spaces on it
  + `      const wasP = String(data_E[row][col_E_Parameters]);\n`
  + `      let nextP = it.size ? mergeFlavour(wasP, "size", it.size) : wasP;\n`
  + `      if (it.setJb) { nextP = mergeFlavour(nextP, "spaces", it.jb); }\n`
  + `      if (nextP !== wasP) { if (nextP === "") { WS_E.getCell(row, col_E_Parameters).${CLEAR}; } else { WS_E.getCell(row, col_E_Parameters).setValue(nextP); } }\n`
  + `      WS_E.getCell(row, col_E_IsPropertiesTBC).${CLEAR};\n`
  + `      console.log(it.ref + ": " + was + " -> " + next + (it.contextRef ? " in " + it.contextRef : ""));\n`
  + `    }\n\n`;

const hubSection = (h) => `    // --- CHANGE: the hub's own size ---\n`
  + `    {\n`
  + `      const row = rowOf_${h.code}.get(${JSON.stringify(h.ref)});\n`
  + `      if (row === undefined) { console.log("WARNING: hub " + ${JSON.stringify(h.ref)} + " not found - its size was not written."); }\n`
  + `      else {\n`
  + `        const was = String(data_${h.code}[row][col_${h.code}_Parameters]);\n`
  + `        const next = mergeFlavour(mergeFlavour(was, "spaces", ${JSON.stringify(h.spaces)}), "capacity", ${JSON.stringify(h.capacity)});\n`
  // every bay separated: the size moved onto the bays, so take it off the hub
  + `        if (next === "") { WS_${h.code}.getCell(row, col_${h.code}_Parameters).${CLEAR}; }\n`
  + `        else if (next !== was) { WS_${h.code}.getCell(row, col_${h.code}_Parameters).setValue(next); }\n`
  + `        WS_${h.code}.getCell(row, col_${h.code}_IsPropertiesTBC).${CLEAR};\n`
  + `        console.log("Hub " + ${JSON.stringify(h.ref)} + ": " + was + " -> " + next);\n`
  + `      }\n`
  + `    }\n\n`;

// ADD last, as the house rules order it. A bay given a Ref that already exists is
// updated in place; one without a Ref is appended under the placeholder.
const baySection = (bays) => `    // --- ADD / CHANGE: an enclosure Element per piece ---\n`
  + `    const bays = [\n${json(bays)}\n    ];\n`
  + `    for (const b of bays) {\n`
  + `      const existing = b.isNew ? undefined : rowOf_E.get(b.ref);\n`
  + `      const row = existing === undefined ? nextRow_E++ : existing;\n`
  + `      if (existing === undefined) {\n`
  + `        WS_E.getCell(row, col_E_Ref).setValue(b.ref);\n`
  + `        WS_E.getCell(row, col_E_Name).setValue(b.name);\n`
  + `        WS_E.getCell(row, col_E_TypeRef).setValue(b.typeRef);\n`
  + `      }\n`
  + `      WS_E.getCell(row, col_E_ContextType).setValue(b.contextType);\n`
  + `      if (b.contextRef) { WS_E.getCell(row, col_E_ContextRef).setValue(b.contextRef); }\n`
  + `      else { console.log("CHECK: bay " + b.name + " has no hub Ref to sit in - set its ContextRef by hand."); }\n`
  + `      const was = existing === undefined ? "" : String(data_E[row][col_E_Parameters]);\n`
  + `      WS_E.getCell(row, col_E_Parameters).setValue(mergeFlavour(mergeFlavour(was, "spaces", b.spaces), "capacity", b.capacity));\n`
  + `      console.log((existing === undefined ? "Appended" : "Updated") + " bay " + b.name + " as " + b.ref`
  + ` + (b.isNew ? " - give it a real Ref, and point its drivers at that Ref." : ""));\n`
  + `    }\n\n`;

// A quantity row broken apart keeps one driver on its own row.
const quantitySection = (rows) => `    // --- CHANGE: a quantity broken apart keeps one ---\n`
  + `    const quantities = [\n${json(rows)}\n    ];\n`
  + `    for (const q of quantities) {\n`
  + `      const row = rowOf_E.get(q.ref);\n`
  + `      if (row === undefined) { console.log("WARNING: " + q.ref + " not found - its Quantity was not changed."); continue; }\n`
  + `      WS_E.getCell(row, col_E_Quantity).setValue(q.quantity);\n`
  + `      console.log(q.ref + ": Quantity " + String(data_E[row][col_E_Quantity]) + " -> " + q.quantity);\n`
  + `    }\n\n`;

// ...and the others become rows of their own, where they were placed. Their Ref is
// the workbook's to allocate, as with any driver added here.
const brokenOutSection = (rows) => `    // --- ADD: drivers broken out of a quantity ---\n`
  + `    const brokenOut = [\n${json(rows)}\n    ];\n`
  + `    for (const el of brokenOut) {\n`
  + `      const row = nextRow_E++;\n`
  + `      WS_E.getCell(row, col_E_Ref).setValue(el.ref);\n`
  + `      if (el.name) { WS_E.getCell(row, col_E_Name).setValue(el.name); }\n`
  + `      WS_E.getCell(row, col_E_TypeRef).setValue(el.typeRef);\n`
  + `      WS_E.getCell(row, col_E_ContextType).setValue(el.contextType);\n`
  + `      WS_E.getCell(row, col_E_ContextRef).setValue(el.contextRef);\n`
  + `      if (el.contextParameters) { WS_E.getCell(row, col_E_ContextParameters).setValue(el.contextParameters); }\n`
  + `      if (el.parameters) { WS_E.getCell(row, col_E_Parameters).setValue(el.parameters); }\n`
  + `      console.log("Appended " + el.ref + " (" + el.typeRef + ") in " + el.contextRef + " " + el.contextParameters);\n`
  + `    }\n`
  + `    console.log("Drivers broken out of a quantity carry the placeholder Ref. Give each a real Ref.");\n\n`;

// Enclosure Elements no longer used: the hub went back to spaces, or has fewer
// pieces than it had. Their drivers were pointed back at the hub above, so only the
// enclosure row is marked. NOT the cascading OMIT: that walks children from the sheet
// as it stood before this patch, would still find the drivers inside, and delete them.
// Out of the usual OMIT-first order for exactly that reason.
const dropEnclosureSection = (refs) => `    // --- OMIT: enclosure Elements no longer used (their drivers moved back first) ---\n`
  + `    const dropEnclosures = [\n${json(refs)}\n    ];\n`
  + `    for (const ref of dropEnclosures) {\n`
  + `      const row = rowOf_E.get(ref);\n`
  + `      if (row === undefined) { console.log("WARNING: enclosure " + ref + " not found - not marked deleted."); continue; }\n`
  + `      WS_E.getCell(row, col_E_IsDeleted).setValue("Y");\n`
  + `      console.log("Enclosure " + ref + " marked IsDeleted; its drivers now sit on the hub.");\n`
  + `    }\n\n`;

const flavours = (params) => {
  const p = parseParams(params ?? '');
  return {
    capacity: p.capacity ? formatParams({ capacity: p.capacity }) : '',
    spaces: p.spaces ? `<${p.spaces}>` : '',
  };
};

// saved: core/layout.save() output. hub: { ref, contextType }.
// typeSizes: [{ ref, size: '[w,h,d]' }], one per driver ElementType.
// typeSizes may carry `spaces`: a wrapper type's parts, '<PSU(...)[...]>'.
// tbc: [{ ref, sheet: 'E' | 'ET', isTBC, isPropertiesTBC }], flags set here.
// jb: { [elementRef]: '<JB.1[...],...>' | '' }, junction boxes set here ('' clears).
// quantities: [{ ref, quantity }], rows whose Quantity changes (a quantity broken apart).
// newElements: { [elementRef]: { typeRef, name } }, drivers broken out of a quantity.
// unplaced: [elementRef], placed in the DB but back in the tray: their placement is cleared.
// dropEnclosures: [enclosureRef], enclosure Elements no longer used, marked IsDeleted.
export function hubPatch({
  saved, hub = null, typeSizes = [], tbc = [], jb = {}, quantities = [], newElements = {}, unplaced = [], dropEnclosures = [],
  tool = 'Driver Assignment Tool',
}) {
  const isNew = (ref) => Object.hasOwn(newElements, ref);
  const brokenOut = (saved?.elements ?? []).filter((e) => isNew(e.ref)).map((e) => ({
    ref: PLACEHOLDER_REF,
    name: newElements[e.ref].name ?? '',
    typeRef: newElements[e.ref].typeRef,
    contextType: e.contextType ?? hub?.contextType ?? 'Position',
    contextRef: e.contextRef ?? hub?.ref ?? '',
    contextParameters: e.contextParameters ?? '',
    parameters: `${e.parameters ?? ''}${jb[e.ref] ?? ''}`,
  }));
  const elements = (saved?.elements ?? []).filter((e) => !isNew(e.ref))
    .map((e) => {
      const cp = parseParams(e.contextParameters);
      const inPiece = e.contextType === 'Element';
      return {
        ref: outRef(e.ref),
        xyz: cp.size ? formatParams({ size: cp.size }) : '',
        spaces: cp.spaces ? `<${cp.spaces}>` : '',
        // Every placed driver says what it sits in, not only one moving into an
        // enclosure: that is how a driver comes back out of one onto the hub.
        contextType: inPiece ? 'Element' : e.contextType ?? hub?.contextType ?? null,
        contextRef: inPiece ? (e.contextRef ?? PLACEHOLDER_REF) : e.contextRef ?? hub?.ref ?? null,
        size: e.parameters ? formatParams({ size: parseParams(e.parameters).size }) : null,
        // every row carries both keys: Office Scripts types the array from its rows
        setJb: Object.hasOwn(jb, e.ref),
        jb: jb[e.ref] ?? '',
      };
    });
  // placed in the DB, now in the tray: its [x,y,z] and <bay> come off the cell
  for (const ref of unplaced) {
    elements.push({ ref: outRef(ref), xyz: '', spaces: '', contextType: null, contextRef: null, size: null, setJb: false, jb: '' });
  }
  const bays = (saved?.slots ?? []).map((b) => ({
    ref: b.ref ?? PLACEHOLDER_REF,
    isNew: !b.ref,
    name: b.name,
    typeRef: b.typeRef ?? '',
    contextType: b.contextType ?? 'Position',
    contextRef: b.contextRef ?? hub?.ref ?? '',
    ...flavours(b.parameters),
  }));

  let body = MERGE_TS
    + header('Elements', 'E',
      ['Ref', 'Name', 'TypeRef', 'ContextType', 'ContextRef', 'Quantity', 'IsDeleted', 'IsTBC', 'IsPropertiesTBC', 'ContextParameters', 'Parameters'],
      ['ContextParameters', 'Parameters', 'IsTBC'])
    + rowMap('E')
    // every append shares one row counter, so bays and new drivers never collide
    + `    let nextRow_E = data_E.length;\n`;
  const flagsOn = (sheet) => tbc.filter((f) => f.sheet === sheet)
    .map((f) => ({ ref: f.ref, isTBC: !!f.isTBC, isPropertiesTBC: !!f.isPropertiesTBC }));
  if (typeSizes.length || flagsOn('ET').length) {
    body += header('ElementTypes', 'ET', ['Ref', 'Parameters', 'IsTBC', 'IsPropertiesTBC'], ['Parameters', 'IsTBC'])
      + rowMap('ET');
  }
  const typeRows = typeSizes.map((t) => ({
    ref: t.ref, size: t.size ?? '', setSpaces: t.spaces != null, spaces: t.spaces ?? '',
  }));
  if (typeRows.length) body += typeSizeSection(typeRows);
  if (elements.length) body += elementSection(elements);
  if (dropEnclosures.length) body += dropEnclosureSection(dropEnclosures);

  if (hub?.ref) {
    const code = hub.contextType === 'Element' ? 'E' : 'P';
    if (code === 'P') {
      body += header('Positions', 'P', ['Ref', 'Parameters', 'IsPropertiesTBC'], ['Parameters']) + rowMap('P');
    }
    body += hubSection({ ref: hub.ref, code, ...flavours(saved?.container?.parameters) });
  } else {
    body += `    console.log("CHECK: no hub Ref was sent, so the hub's own size "`
      + ` + ${JSON.stringify(saved?.container?.parameters ?? '')} + " was not written.");\n\n`;
  }
  if (quantities.length) body += quantitySection(quantities);
  if (bays.length) body += baySection(bays);
  if (brokenOut.length) body += brokenOutSection(brokenOut);
  if (flagsOn('E').length) body += tbcSection('E', flagsOn('E'));
  if (flagsOn('ET').length) body += tbcSection('ET', flagsOn('ET'));
  return script(body, tool);
}
