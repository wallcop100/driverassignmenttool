// Host-side overlay for the Driver Assignment Tool.
//
// This lives in the DataJoin overlay template (DJ 101681), NOT in the tool.
// It is baked into each rendered design page, so a page rendered before an
// edit here keeps running the old copy — re-run the DJ after changing it.
//
// Two fixes over the previous version:
//
//   1. TOOL_ORIGIN is prepended to the iframe src. A bare
//      "/driverassignmenttool/api/..." is relative to the *parent* document, so
//      it resolved against kaizen.ideaworksgroup.co.uk and hit IIS instead of
//      GitHub Pages. An iframe src authored in the parent must be absolute.
//
//   2. No `if (!window.__datOpen)` guard. Every hub button carries its own copy
//      of this function; with the guard, the first one clicked won on the page
//      and every later copy — including a corrected one — was silently skipped.
//      One stale button poisoned the whole page. Last definition wins now.
//
// Note: the tool's own asset paths stay relative (../assets/...) and that is
// correct — inside the frame they resolve against the frame's own URL.

var TOOL_ORIGIN = 'https://wallcop100.github.io';
var TOOL_PATH = '/driverassignmenttool/api/';

window.__datOpen = function (ref, hub, ver) {
  var src = TOOL_ORIGIN + TOOL_PATH + '?parentOrigin=' + encodeURIComponent(location.origin);

  var f = document.getElementById('datf_' + ref);
  var l = document.getElementById('datl_' + ref);
  if (!f || !l) { IWalertmessage('No data block for ' + ref); return; }
  var form = f.textContent, links = l.textContent;

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

  function save(n, c) {
    var u = URL.createObjectURL(new Blob([c], { type: 'text/plain' }));
    var a = document.createElement('a');
    a.href = u; a.download = n; a.click();
    URL.revokeObjectURL(u);
  }

  function onMsg(e) {
    if (e.source !== fr.contentWindow) return;
    if (e.origin !== TOOL_ORIGIN) return;
    var m = e.data;
    if (!m) return;

    if (m.type === 'dat:ready') {
      ready = true;
      clearTimeout(watchdog);
      st.textContent = '';
      fr.contentWindow.postMessage({
        type: 'dat:init',
        version: 1,
        form: form,
        links: links,
        focusZone: hub,
        context: { systemSetId: ver, hubRef: ref, hubLabel: hub },
      }, TOOL_ORIGIN);
    }
    if (m.type === 'dat:dirty') {
      dirty = m.changeCount;
      st.textContent = dirty ? dirty + ' unsaved' : '';
    }
    if (m.type === 'dat:error') IWalertmessage('Driver tool: ' + m.message);
    if (m.type === 'dat:export') {
      if (m.kind === 'patch') {
        copyToClipboard(m.content);
        IWalertmessage('Patch script copied - paste it into the Office Scripts editor');
      } else {
        save(m.filename, m.content);
        IWalertmessage('Exported ' + m.filename);
      }
    }
  }
  window.addEventListener('message', onMsg);

  function shut() {
    if (dirty && !confirm(dirty + ' unsaved change(s). Close anyway?')) return;
    clearTimeout(watchdog);
    window.removeEventListener('message', onMsg);
    back.remove(); pan.remove();
  }
  xb.onclick = shut;
  back.onclick = shut;
};
