// An error's name, for reporting it.
//
// The person who hits a crash has to be able to say which crash it was, and the
// person hunting it has to be able to tell two reports apart. So the id is a
// hash of what identifies the fault - the message and the first frame of the
// stack - and NOT of when it happened: the same bug reported by three people
// carries the same id, and a different bug never borrows it.
//
// Six hex characters is 16 million: enough that two live faults colliding is
// not worth designing around, short enough to read down a phone.

const FRAME = /at .+?(?:\((.+?)\)|(\S+:\d+:\d+))/; // the first "at ..." line, file:line:col

// The line of a stack that says where, without the parts that move: a bundled
// asset's hash changes every build, and a port or host changes per machine.
export function stackSite(stack = '') {
  const line = String(stack).split('\n').find((l) => FRAME.test(l)) ?? '';
  const m = line.match(FRAME);
  const site = (m?.[1] ?? m?.[2] ?? '').trim();
  return site
    .replace(/^https?:\/\/[^/]+/, '')        // host and port
    .replace(/-[A-Za-z0-9_-]{8,}(?=\.\w+)/, '') // the build's content hash
    .replace(/\?.*$/, '');
}

// FNV-1a: tiny, stable across runs and builds, which is the whole point.
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0').slice(-6).toUpperCase();
}

// Numbers in a message are usually the specific value that broke it, not the
// fault itself, so they are flattened: "row 47 is missing" and "row 48 is
// missing" are one bug to fix.
export function errorId(error, extra = '') {
  const message = String(error?.message ?? error ?? '').replace(/\d+/g, '#').slice(0, 300);
  return `DAT-${hash(`${message}|${stackSite(error?.stack)}|${extra}`)}`;
}
