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
export const MERGE_TS = `    const mergeFlavour = (current: string, flavour: string, value: string): string => {
      let rest = String(current === null || current === undefined ? "" : current);
      if (flavour === "size") rest = rest.replace(/(^|[^\\[])\\[[^\\[\\]]*\\](?!\\])/, "$1");
      if (flavour === "capacity") rest = rest.replace(/\\[\\[[^\\]]*\\]\\]/, "");
      if (flavour === "spaces") rest = rest.replace(/<[^>]*>/, "");
      rest = rest.trim();
      return value ? value + rest : rest;
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
  + `      const next = mergeFlavour(was, "size", t.size);\n`
  + `      if (next === was) { console.log("Type " + t.ref + " already " + t.size); continue; }\n`
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
  + `      if (next !== was) { WS_E.getCell(row, col_E_ContextParameters).setValue(next); }\n`
  // moved into a separated bay: its parent is now that bay's Element
  + `      if (it.contextRef) {\n`
  + `        WS_E.getCell(row, col_E_ContextType).setValue(it.contextType);\n`
  + `        WS_E.getCell(row, col_E_ContextRef).setValue(it.contextRef);\n`
  + `      }\n`
  // turned: the Element states its as-placed size over its type's
  + `      if (it.size) { WS_E.getCell(row, col_E_Parameters).setValue(mergeFlavour(String(data_E[row][col_E_Parameters]), "size", it.size)); }\n`
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
const baySection = (bays) => `    // --- ADD: separated bays ---\n`
  + `    const bays = [\n${json(bays)}\n    ];\n`
  + `    let next_E = data_E.length;\n`
  + `    for (const b of bays) {\n`
  + `      const existing = b.isNew ? undefined : rowOf_E.get(b.ref);\n`
  + `      const row = existing === undefined ? next_E++ : existing;\n`
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

const flavours = (params) => {
  const p = parseParams(params ?? '');
  return {
    capacity: p.capacity ? formatParams({ capacity: p.capacity }) : '',
    spaces: p.spaces ? `<${p.spaces}>` : '',
  };
};

// saved: core/layout.save() output. hub: { ref, contextType }.
// typeSizes: [{ ref, size: '[w,h,d]' }], one per driver ElementType.
// tbc: [{ ref, sheet: 'E' | 'ET', isTBC, isPropertiesTBC }], flags set here.
export function hubPatch({ saved, hub = null, typeSizes = [], tbc = [], tool = 'Driver Assignment Tool' }) {
  const elements = (saved?.elements ?? [])
    .map((e) => {
      const cp = parseParams(e.contextParameters);
      const moved = e.contextType === 'Element';
      return {
        ref: outRef(e.ref),
        xyz: cp.size ? formatParams({ size: cp.size }) : '',
        spaces: cp.spaces ? `<${cp.spaces}>` : '',
        contextType: moved ? 'Element' : null,
        contextRef: moved ? (e.contextRef ?? PLACEHOLDER_REF) : null,
        size: e.parameters ? formatParams({ size: parseParams(e.parameters).size }) : null,
      };
    });
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
      ['Ref', 'Name', 'TypeRef', 'ContextType', 'ContextRef', 'IsTBC', 'IsPropertiesTBC', 'ContextParameters', 'Parameters'],
      ['ContextParameters', 'Parameters', 'IsTBC'])
    + rowMap('E');
  const flagsOn = (sheet) => tbc.filter((f) => f.sheet === sheet)
    .map((f) => ({ ref: f.ref, isTBC: !!f.isTBC, isPropertiesTBC: !!f.isPropertiesTBC }));
  if (typeSizes.length || flagsOn('ET').length) {
    body += header('ElementTypes', 'ET', ['Ref', 'Parameters', 'IsTBC', 'IsPropertiesTBC'], ['Parameters', 'IsTBC'])
      + rowMap('ET');
  }
  if (typeSizes.length) body += typeSizeSection(typeSizes);
  if (elements.length) body += elementSection(elements);

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
  if (bays.length) body += baySection(bays);
  if (flagsOn('E').length) body += tbcSection('E', flagsOn('E'));
  if (flagsOn('ET').length) body += tbcSection('ET', flagsOn('ET'));
  return script(body, tool);
}
