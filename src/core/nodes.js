// Node-name hygiene, which is a property of Parameter Syntax rather than of any
// one kind of equipment.
//
// A colon is banned in a node name. `{<OP.1:2}` was being written to mean one
// node carrying two outputs; the correct form is `{<OP.1-2}`. The same rule
// applies to a panel module's terminals — `{<A:B}` is as wrong as `{<OP.1:2}` —
// so the rule belongs here and not beside the drivers.
export const BANNED_NODE = /:/;

export const fixNodeName = (name) => String(name ?? '').replace(/:/g, '-');

// Every type in an inventory whose Parameters use the banned form, with what
// each node becomes. `inventory` is any list of `{ nodes: [{ name }] }`.
export function bannedNodes(model) {
  return (model?.inventory ?? [])
    .map((t) => ({
      t,
      nodes: (t.nodes ?? []).filter((n) => BANNED_NODE.test(n.name))
        .map((n) => ({ from: n.name, to: fixNodeName(n.name) })),
    }))
    .filter((x) => x.nodes.length > 0);
}

// A node recipe, as Parameter Syntax writes it (page 100966):
//
//   {<OP.1,<OP.2}              a driver's outputs
//   {<A(DL1),>NET}             a panel module's terminals, one with a detail
//   {>IP.01,<>Passthrough}     direction: > displays left/in, < right/out,
//                              <> a through node
//
// Direction and the bracketed detail are stripped off the NAME, because the name
// is the key a link end is written against — `{<A(DL1)}` on the type and `{A}`
// on the link end are the same terminal.
// Direction is documented as a PREFIX on page 100966, and the estate writes it
// both ways: ET-MOD-AP4 on branch 10328 holds `{>LAN,NET<>,<24(24V Input)}` —
// LAN prefixed, NET suffixed, in the same recipe. Taking only the prefix left a
// terminal called "NET<>" that no link end could ever match.
const NODE_RE = /^(<>|>|<)?\s*([^()<>]*?)\s*(<>|>|<)?\s*(?:\(([^)]*)\))?$/;

export function parseNodeList(nodes) {
  const body = String(nodes ?? '').replace(/^\{|\}$/g, '').trim();
  if (!body) return [];
  return body.split(',').map((raw) => {
    const m = NODE_RE.exec(raw.trim());
    if (!m || !m[2]) return null;
    return { name: m[2], dir: m[1] ?? m[3] ?? null, detail: m[4] ?? null };
  }).filter(Boolean);
}

// A discrete-space recipe: '<01,02,03,,04,LB1,P1>' -> the slots a container has.
//
// Three things the LCP overlay (DJ 101676) had to get right and so must this:
// a BLANK entry is a real empty space and is kept; dot syntax groups, so a
// module in <1.1> belongs to slot 1; and <1> and <01> are the same slot.
export function parseSlotList(spaces) {
  const body = String(spaces ?? '').replace(/^<|>$/g, '');
  if (!body.trim() && body === '') return [];
  return body.split(',').map((s, i) => ({ name: s.trim(), index: i, blank: !s.trim() }));
}

// Two slot names meaning the same slot. Three conventions live in the estate at
// once and DJ 101676 matches all three:
//
//   <1> and <01>      the same way, written with and without the zero
//   <1.1>             dot syntax groups, so it folds onto way 1
//   <08a> and <08b>   letter-suffixed sub-ways of way 08
//   <P1> and <P.1>    the same way, dotted or not
//
// So: a name starting with digits keys on those digits; anything else keys on
// its letters with the dots taken out.
export const slotKey = (name) => {
  const t = String(name ?? '').trim();
  const digits = /^(\d+)/.exec(t);
  return digits ? String(Number(digits[1])) : t.replace(/\./g, '').toUpperCase();
};
export const sameSlot = (a, b) => slotKey(a) === slotKey(b);
