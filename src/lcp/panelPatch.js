// Moving modules between a panel's ways, as an ExcelScript patch.
//
// The way is the <discrete space> in Elements.ContextParameters. It is merged in
// the script against the live cell, so a [x,,] or anything else already there
// survives, and a module taken out of every way has only its <..> removed.
import { script, header, json, CLEAR } from '../core/patch.js';
import { outRef } from '../core/csv.js';

const norm = (s) => String(s ?? '').trim().toUpperCase().replace(/^0+(?=\d)/, '');

// Which declared way a written way belongs to, or null for none. The estate
// writes the same way several ways, and DJ 101676 matches them all:
//   <01.a> <01.b>   two modules sharing way 01 (dot groups)
//   <08a>           way 08a where the recipe declares it, else way 08
//   <1> <01>        the same way
//   <P.1> <P1>      the same way
export function rowFor(way, rows) {
  if (way == null || String(way).trim() === '') return null;
  const named = (rows ?? []).filter((r) => r?.name);
  const n = norm(way);
  const exact = named.find((r) => norm(r.name) === n);
  if (exact) return exact.name;
  if (!/^\d/.test(n)) {
    const dotless = named.find((r) => norm(r.name).replace(/\./g, '') === n.replace(/\./g, ''));
    if (dotless) return dotless.name;
  }
  const head = n.split('.')[0];
  const byHead = named.find((r) => norm(r.name) === head);
  if (byHead) return byHead.name;
  const digits = /^(\d+)/.exec(head)?.[1];
  return (digits && named.find((r) => norm(r.name) === digits)?.name) || null;
}

// The merge the script runs. TypeScript, because Office Scripts refuse an
// untyped function; the tests strip the annotations and run this same text.
export const WAY_TS = `    const setWay = (current: string, way: string): string => {
      const rest = String(current === null || current === undefined ? "" : current).replace(/<[^>]*>/, "").trim();
      return way ? "<" + way + ">" + rest : rest;
    };
`;

// moves: [{ ref, to }] where `to` is the way name, or '' to take it out of one
export function panelPatch(moves, tool = 'LCP Assignment Tool') {
  const rows = (moves ?? []).map((m) => ({ ref: outRef(m.ref), to: m.to ?? '' }));
  if (!rows.length) return script('    console.log("Nothing to move.");\n', tool);
  return script(WAY_TS
    + header('Elements', 'E', ['Ref', 'ContextParameters', 'IsPropertiesTBC'], ['ContextParameters'])
    + `    const rowOf_E = new Map<string, number>();\n`
    + `    for (let i = 1; i < data_E.length; i++) { rowOf_E.set(String(data_E[i][col_E_Ref]), i); }\n`
    + `    // --- CHANGE: module ways ---\n`
    + `    const moves = [\n${json(rows)}\n    ];\n`
    + `    for (const m of moves) {\n`
    + `      const row = rowOf_E.get(m.ref);\n`
    + `      if (row === undefined) { console.log("WARNING: " + m.ref + " not found in Elements - skipped."); continue; }\n`
    + `      const was = String(data_E[row][col_E_ContextParameters]);\n`
    + `      const next = setWay(was, m.to);\n`
    + `      if (next === was) { continue; }\n`
    + `      if (next === "") { WS_E.getCell(row, col_E_ContextParameters).${CLEAR}; }\n`
    + `      else { WS_E.getCell(row, col_E_ContextParameters).setValue(next); }\n`
    + `      WS_E.getCell(row, col_E_IsPropertiesTBC).${CLEAR};\n`
    + `      console.log(m.ref + ": " + (was || "(no way)") + " -> " + (next || "(no way)"));\n`
    + `    }\n`, tool);
}
