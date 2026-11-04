// The driver type library, read from an Excel DesignDB instead of DJ 101681.
//
// The workbook's ElementTypes sheet carries the same flattened columns the
// overlay's type library selects (sysex-overlay-DJ101681.sql, section 0), under
// the same names, so this is that SELECT ported to rows: it emits the type CSV
// the overlay would, and parseTypes() takes it from there unchanged. Keep the
// two in step - if the overlay's filter or Channels rule changes, change this.
import Papa from 'papaparse';

const COLUMNS = ['ElementTypeRef', 'ElementTypeName', 'MaxPower(W)', 'CurrentRange', 'OutputVoltage(V)',
  'NodeMaxPower(W)', 'NodeMaxForwardVoltage(fV)', 'NodeCurrent', 'ControlType', 'BallastCountPerUoM',
  'Channels', 'Parameters', 'IsTBC', 'IsPropertiesTBC'];

const s = (v) => (v == null ? '' : String(v).trim());
const live = (r) => s(r.IsDeleted) === '';

// The overlay's CASE: '<' marks each output; failing that every comma-separated
// OP. entry is one; failing that one, because a 0CH type cannot be sized at all.
export function channels(params) {
  const p = s(params);
  if (p.includes('<')) return p.split('<').length - 1;
  if (p.includes('OP.')) return p.replace(/[{}]/g, '').split(',').length;
  return 1;
}

// sheets: { ElementTypes: rows[], Elements: rows[], Positions: rows[] }, each row an
// object keyed by the sheet's header. Returns the type library as CSV text.
export function typesCsvFromSheets({ ElementTypes = [], Elements = [], Positions = [] }) {
  const elements = Elements.filter(live);
  const byRef = new Map(elements.map((e) => [s(e.Ref), e]));
  // A driver's parts (#Compositions): children of a live Element. Taken before
  // the generated _EE rows are dropped, as the overlay does.
  const parts = new Set(elements
    .filter((c) => s(c.ContextType) === 'Element' && byRef.has(s(c.ContextRef)))
    .map((c) => s(c.TypeRef)));
  // Placed on a hub. The overlay knows the hub PositionTypes from the host
  // (@Container_TypeRef); the workbook does not say, so a hub is any Position a
  // fitting names as its secondary power.
  // shortcut: hubs nobody points at yet are missed, upgrade if a tender DesignDB shows drivers on one.
  const hubs = new Set(Positions.filter(live).map((p) => s(p.Link_SecondaryPowerRef)).filter(Boolean));
  const placed = new Set(elements
    .filter((e) => !s(e.Ref).startsWith('_EE') && s(e.ContextType) === 'Position' && hubs.has(s(e.ContextRef)))
    .map((e) => s(e.TypeRef)));

  const rows = ElementTypes.filter(live)
    .filter((t) => s(t.Ref))
    .filter((t) => /<|OP\./.test(s(t.Parameters)) || parts.has(s(t.Ref)) || placed.has(s(t.Ref)))
    .sort((a, b) => s(a.Ref).localeCompare(s(b.Ref)))
    .map((t) => ({
      ...Object.fromEntries(COLUMNS.map((c) => [c, s(t[c])])),
      ElementTypeRef: s(t.Ref),
      ElementTypeName: s(t.Name),
      Channels: String(channels(t.Parameters)),
    }));
  return Papa.unparse({ fields: COLUMNS, data: rows.map((r) => COLUMNS.map((c) => r[c])) });
}

// The overlay's datc_ and date_ blocks (section 2d) from the workbook: the parts
// of every wrapper type, and per hub its own row, separated bays and Elements, so
// the space layout can be drawn from the DesignDB with no cables. The overlay is
// told which PositionTypes are hubs; the workbook is not, so a hub is a Position
// holding a driver Element (a type with outputs, or with parts of its own) or one
// a fitting names as its secondary power. Keep in step with the overlay.
const HUB_COLUMNS = ['Ref', 'Kind', 'ContextRef', 'Parameters', 'ContextParameters', 'Quantity', 'TypeRef', 'Name'];
const isBay = (e) => s(e.TypeRef).startsWith('ET-PSU-ENC');

export function hubsFromSheets({ ElementTypes = [], Elements = [], Positions = [] }) {
  const all = Elements.filter(live);
  const byRef = new Map(all.map((e) => [s(e.Ref), e]));
  // like #Compositions, taken before the generated _EE rows are dropped
  const comp = new Map();
  for (const c of all) {
    if (s(c.ContextType) !== 'Element' || !byRef.has(s(c.ContextRef))) continue;
    const k = `${s(byRef.get(s(c.ContextRef)).TypeRef)}\t${s(c.TypeRef)}`;
    const q = Number(c.Quantity) || 1;
    const o = Number(c.SortOrder) || 0;
    const was = comp.get(k);
    comp.set(k, was ? [Math.max(was[0], q), Math.min(was[1], o)] : [q, o]);
  }
  const compositions = Papa.unparse({
    fields: ['ParentTypeRef', 'ChildTypeRef', 'Quantity', 'SortOrder'],
    data: [...comp].map(([k, [q, o]]) => [...k.split('\t'), q, o]),
  });

  const elements = all.filter((e) => !s(e.Ref).startsWith('_EE'));
  const parents = new Set(elements.filter((c) => s(c.ContextType) === 'Element').map((c) => s(c.ContextRef)));
  const outputs = new Set(ElementTypes.filter(live).filter((t) => /<|OP\./.test(s(t.Parameters))).map((t) => s(t.Ref)));
  const inside = new Map();     // ContextRef -> Elements in it
  for (const e of elements) {
    const k = `${s(e.ContextType)}\t${s(e.ContextRef)}`;
    if (!inside.has(k)) inside.set(k, []);
    inside.get(k).push(e);
  }
  const positions = Positions.filter(live);
  const named = new Set(positions.map((p) => s(p.Link_SecondaryPowerRef)).filter(Boolean));
  const row = (e, Kind) => Object.fromEntries(HUB_COLUMNS.map((c) => [c, c === 'Kind' ? Kind : s(e[c])]));
  const hubs = {};
  for (const p of positions) {
    const here = inside.get(`Position\t${s(p.Ref)}`) ?? [];
    if (!named.has(s(p.Ref)) && !here.some((e) => outputs.has(s(e.TypeRef)) || parents.has(s(e.Ref)))) continue;
    const bays = here.filter(isBay);
    const rows = [
      { Ref: s(p.Ref), Kind: 'hub', Parameters: s(p.Parameters) },
      ...bays.map((e) => row(e, 'bay')),
      ...here.filter((e) => !isBay(e)).map((e) => row(e, 'element')),
      ...bays.flatMap((b) => inside.get(`Element\t${s(b.Ref)}`) ?? []).map((e) => row(e, 'element')),
    ];
    hubs[s(p.ExtRef) || s(p.Ref)] = Papa.unparse({ fields: HUB_COLUMNS, data: rows.map((r) => HUB_COLUMNS.map((c) => r[c] ?? '')) });
  }
  return { hubs, compositions };
}

// PositionType Ref -> UoM ('m', 'm2'), for an assessment exported without the UoM column
// A deleted PositionType still counts (positions in the assessment can use it);
// a live row with the same Ref wins.
export const positionUoms = (rows) => Object.fromEntries(Object.entries(Object.fromEntries(
  [...rows.filter((r) => !live(r)), ...rows.filter(live)].map((r) => [s(r.Ref), s(r.UoM)])))
  .filter(([ref, u]) => ref && u));

export const isWorkbook = (file) => /\.xls[xm]$/i.test(file.name);

// SheetJS is only loaded when somebody drops a workbook, so the CSV path stays light.
export async function readDesignDb(file) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { sheets: ['ElementTypes', 'Elements', 'Positions', 'PositionTypes'] });
  if (!wb.SheetNames.includes('ElementTypes')) {
    throw new Error(`${file.name} has no ElementTypes sheet - is it a DesignDB?`);
  }
  const rows = (n) => (wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }) : []);
  const sheets = { ElementTypes: rows('ElementTypes'), Elements: rows('Elements'), Positions: rows('Positions') };
  return {
    types: typesCsvFromSheets(sheets),
    uom: positionUoms(rows('PositionTypes')),
    ...hubsFromSheets(sheets),
  };
}
