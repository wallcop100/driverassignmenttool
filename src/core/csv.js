// CSV reading, and the one comparison every diff in either tool needs.
//
// The DataJoin export format has quoted fields, embedded commas and BOM headers
// that a hand-written split(',') mishandles, so PapaParse earns its place here.
// Which CSVs a tool expects is the tool's business - `detectKind` stays with the
// driver tool, because only its standalone entry sniffs dropped files. The LCP
// tool is reached from its overlay, which pushes named payloads.
import Papa from 'papaparse';

export function readCsv(text, required, label, allowEmpty = false) {
  const { data, meta, errors } = Papa.parse(text, { header: true, skipEmptyLines: 'greedy' });
  if (!data.length && !allowEmpty) throw new Error(`${label}: file is empty or has no data rows`);
  if (!data.length) return { rows: [], fields: meta.fields ?? [] };
  const missing = required.filter((c) => !meta.fields.includes(c));
  if (missing.length) throw new Error(`${label}: missing column(s): ${missing.join(', ')}`);
  if (errors.length) throw new Error(`${label}: ${errors[0].message} (row ${errors[0].row})`);
  return { rows: data, fields: meta.fields };
}

// Two ref lists holding the same refs, order and duplicates ignored. Used by
// every "has this actually changed?" test in a diff.
export const sameRefs = (a, b) => {
  const x = [...(a ?? [])].sort();
  const y = [...(b ?? [])].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

// An Element Ref as the workbook spells it. A tool may key an added row as
// `E5000X~2` to keep two of them apart in memory; the sheet only ever sees the
// part before the tilde.
export const outRef = (ref) => String(ref).split('~')[0];

// Every row a tool appends carries this until somebody gives it a real Ref.
// Elements.Ref must be unique, so the review surface has to say so.
export const PLACEHOLDER_REF = 'E5000X';
