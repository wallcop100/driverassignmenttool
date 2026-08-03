// Host-side overlay for the Driver Assignment Tool.
//
// This lives in the DataJoin overlay template (DJ 101681), NOT in the tool.
// It is baked into each rendered design page, so a page rendered before an
// edit here keeps running the old copy — re-run the DJ after changing it.
//
// Changes over the previous version:
//
//   1. TOOL_ORIGIN is prepended to the iframe src. A bare
//      "/driverassignmenttool/api/..." is relative to the *parent* document, so
//      it resolved agains example.com and hit IIS instead of
//      GitHub Pages. An iframe src authored in the parent must be absolute.
//
//   2. No `if (!window.__datOpen)` guard. Every hub button carries its own copy
//      of this function; with the guard, the first one clicked won on the page
//      and every later copy — including a corrected one — was silently skipped.
//      One stale button poisoned the whole page. Last definition wins now.
//
//   3. context.branchId is sent, so the tool can scope and retire saved work
//      per branch. See the __datOpen signature below.
//
//   4. No close confirmation, and exports are always the patch script — the
//      tool suppresses its CSV output when embedded.
//
// Note: the tool's own asset paths stay relative (../assets/...) and that is
// correct — inside the frame they resolve against the frame's own URL.

var TOOL_ORIGIN = 'https://wallcop100.github.io';
var TOOL_PATH = '/driverassignmenttool/api/';

// __datOpen(hubRef, hubLabel, systemSetId, branchId)
//
// branchId + systemSetId together scope the tool's saved work. systemSetIds are
// sequential within a branch, so when the user opens a newer set the tool drops
// every stored session for that branch below it — no stale work, no manual
// cleanup. Send the branch the design belongs to, as a plain id; the tool never
// parses it beyond comparing equality.
//
// Both must be present for that to work. Omit branchId and every branch shares
// one namespace, so a newer set in branch A would wipe branch B's work.
window.__datOpen = function (ref, hub, ver, branch) {
  var src = TOOL_ORIGIN + TOOL_PATH + '?parentOrigin=' + encodeURIComponent(location.origin);

  var f = document.getElementById('datf_' + ref);
  var l = document.getElementById('datl_' + ref);
  if (!f || !l) { IWalertmessage('No data block for ' + ref); return; }
  var form = f.textContent, links = l.textContent;

  // Driver type library — ONE block for the whole page, not one per hub. The
  // per-hub rows carry no "Driver Restrictions"; the tool joins the ratings on
  // ElementTypeRef from here. Optional: without it the tool still works, but
  // every driver reads as "type undeclared" and Add Driver can only offer the
  // types the hub already contains.
  var ty = document.getElementById('dat_types');
  var types = ty ? ty.textContent : '';

  // The CSVs must keep their line breaks. If the overlay writer ever collapses
  // them, the tool sees one row and reports a column error — catch it here
  // instead, where the message can name the cause.
  if (form.indexOf('\n') === -1 || links.indexOf('\n') === -1) {
    IWalertmessage('Driver tool: CSV data block for ' + ref + ' has no line breaks — check the overlay writer.');
    return;
  }

  var back = document.createElement('div');
  back.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:20000';
  var pan = document.createElement('div');
  pan.style.cssText = 'position:fixed;top:3vh;left:3vw;right:3vw;bottom:3vh;background:#fff;border-radius:6px;z-index:20001;display:flex;flex-direction:column;overflow:hidden';
  var bar = document.createElement('div');
  bar.style.cssText = 'padding:6px 10px;border-bottom:1px solid #ddd;font:13px system-ui;display:flex;align-items:center;gap:10px;flex:0 0 auto';

  var ti = document.createElement('strong');
  ti.textContent = 'Driver assignment - ' + hub;
  var st = document.createElement('span');
  st.style.cssText = 'color:#888';
  st.textContent = 'connecting…';
  var xb = document.createElement('button');
  xb.textContent = 'Close';
  xb.style.cssText = 'margin-left:auto';
  bar.appendChild(ti); bar.appendChild(st); bar.appendChild(xb);

  var fr = document.createElement('iframe');
  fr.style.cssText = 'flex:1 1 auto;border:0;width:100%';
  fr.setAttribute('allow', 'clipboard-write');
  fr.src = src;

  pan.appendChild(bar); pan.appendChild(fr);
  document.body.appendChild(back); document.body.appendChild(pan);

  var dirty = 0, ready = false;

  // If the frame never handshakes, say so rather than showing a blank panel.
  // Usual causes: wrong origin in the tool's allowlist, or the frame 404'd.
  var watchdog = setTimeout(function () {
    if (!ready) st.textContent = 'no response from tool - check console';
  }, 8000);

  function onMsg(e) {
    if (e.source !== fr.contentWindow) return;
    if (e.origin !== TOOL_ORIGIN) return;
    var m = e.data;
    if (!m) return;

    if (m.type === 'dat:ready') {
      ready = true;
      clearTimeout(watchdog);
      st.textContent = '';
      // Types BEFORE init. postMessage preserves order from one source, so
      // sending them in this order is enough — no ack needed. Arriving after
      // init still works, but only while the user has made no changes yet.
      if (types) {
        fr.contentWindow.postMessage({ type: 'dat:types', version: 1, types: types }, TOOL_ORIGIN);
      }
      fr.contentWindow.postMessage({
        type: 'dat:init',
        version: 1,
        form: form,
        links: links,
        focusZone: hub,
        context: { branchId: branch, systemSetId: ver, hubRef: ref, hubLabel: hub },
      }, TOOL_ORIGIN);
    }
    if (m.type === 'dat:dirty') {
      dirty = m.changeCount;
      st.textContent = dirty ? dirty + ' unsaved' : '';
    }
    if (m.type === 'dat:error') IWalertmessage('Driver tool: ' + m.message);
    // Embedded, the tool only ever emits kind:'patch' — the CSV round-trip is
    // disabled there because this workbook cannot ingest that format.
    if (m.type === 'dat:export') {
      copyToClipboard(m.content);
      IWalertmessage('Patch script copied - paste it into the Office Scripts editor');
    }
  }
  window.addEventListener('message', onMsg);

  // No close confirmation: work is autosaved per hub and resumes silently when
  // the hub is reopened, so closing loses nothing. The 'N unsaved' label stays
  // as a reminder that the patch has not been taken yet.
  function shut() {
    clearTimeout(watchdog);
    window.removeEventListener('message', onMsg);
    back.remove(); pan.remove();
  }
  xb.onclick = shut;
  back.onclick = shut;
};
