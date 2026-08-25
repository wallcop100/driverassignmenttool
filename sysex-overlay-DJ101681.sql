-- SysEx Overlay - Lighting Interactive Driver Assignment --
-- V1.2 --

--SQL HEADER--
DECLARE @Container_TypeRef AS varchar(max) = 'PSU.HUB';   -- comma separated list of PSU-HUB Types
DECLARE @SystemBranchID   AS INT          = 10470;        -- only used when @SystemSetID = 0
DECLARE @SystemSetID      AS INT          = 0;            -- 0 = latest committed set of @SystemBranchID
DECLARE @EntityTypeFilter AS varchar(max) = NULL;


-- SQL BODY ---

DECLARE @ToolOrigin       AS varchar(200) = 'https://wallcop100.github.io';
DECLARE @ToolPath         AS varchar(200) = '/driverassignmenttool/api/';
DECLARE @DataVersion      AS varchar(50)  = '';           -- blank = @SystemSetID. See notes.

-- SysEx Overlay - Lighting - Driver Assignment Tool. Puts a launcher on every
-- PSU-HUB position. Design rationale and load-bearing gotchas (setup order,
-- no onclick guard, absolute iframe src, the '>' prefix, escaping model,
-- load-time caching) are in this DataJoin's internal notes - read those
-- before touching setup order, the JS handler, or overlay attribute plumbing.
-- User docs: DataJoins & Overlays > Documentation > Lighting Documentation >
-- Lighting Overlays > Driver Assignment Tool (page 140146).

DECLARE @NL varchar(2) = CHAR(13)+CHAR(10);

-- Header DECLAREs become this DataJoin's PARAMETER SET, and the stored value
-- wins over the literal in the header. Test for a valid absolute origin, NOT
-- just for blank: a stored '/' is non-blank and produced src='//driver...'.
IF LEFT(ISNULL(@ToolOrigin,''),4) <> 'http' SET @ToolOrigin = 'https://wallcop100.github.io';
IF LEFT(ISNULL(@ToolPath,''),1)   <> '/'    SET @ToolPath   = '/driverassignmenttool/api/';
SET @ToolOrigin = LEFT(@ToolOrigin, LEN(@ToolOrigin) - CASE WHEN RIGHT(@ToolOrigin,1)='/' THEN 1 ELSE 0 END);
WHILE LEFT(@ToolPath,2) = '//' SET @ToolPath = RIGHT(@ToolPath, LEN(@ToolPath)-1);
IF ISNULL(@Container_TypeRef,'')= '' SET @Container_TypeRef= 'PSU.HUB';

-- The point-in-time token that keys the user's saved session. A SystemSetID is
-- the right value when there is one: it changes exactly when the design does,
-- so unsaved work is offered back while the data is unchanged and retires when
-- it is not. Falling back to today's date only retires sessions daily, which is
-- safe but blunt.
-- Resolve the set/branch pair: give either, derive the other. MUST run before
-- Rehydrates from @SystemSetID.
IF ISNULL(@SystemSetID,0) = 0 AND ISNULL(@SystemBranchID,0) <> 0
    SET @SystemSetID = (SELECT TOP 1 SystemSetID FROM SystemSets
                        WHERE SystemBranchID = @SystemBranchID ORDER BY Added DESC);
IF ISNULL(@SystemBranchID,0) = 0
    SET @SystemBranchID = (SELECT TOP 1 SystemBranchID FROM SystemSets
                           WHERE SystemSetID = @SystemSetID);
DECLARE @Ver varchar(50) = ISNULL(NULLIF(@DataVersion,''), CONVERT(varchar(50), @SystemSetID));
-- No date fallback now: the set id IS the point in time.
DECLARE @Branch varchar(50) = CONVERT(varchar(50), ISNULL(@SystemBranchID,0));

{{>SystemSetDesignDB}}

--|Remove Deleted|--
	DELETE FROM #LocationsRaw WHERE NOT ISNULL(IsDeleted,'')='';
	DELETE FROM #PositionsRaw WHERE NOT ISNULL(IsDeleted,'')='';
	DELETE FROM #PositionTypes WHERE NOT ISNULL(IsDeleted,'')='';
	DELETE FROM #ElementsRaw WHERE NOT ISNULL(IsDeleted,'')='';
	DELETE FROM #ElementsRaw WHERE Ref LIKE '_EE%'; --Remove Expanded Entities
--|Drop ID_|--  guarded, so a re-run or an upstream drop cannot break the batch
	IF COL_LENGTH('tempdb..#LocationsRaw','ID_') IS NOT NULL ALTER TABLE #LocationsRaw DROP COLUMN [ID_];
	IF COL_LENGTH('tempdb..#PositionsRaw','ID_') IS NOT NULL ALTER TABLE #PositionsRaw DROP COLUMN [ID_];
	IF COL_LENGTH('tempdb..#PositionTypes','ID_') IS NOT NULL ALTER TABLE #PositionTypes DROP COLUMN [ID_];
	IF COL_LENGTH('tempdb..#ElementsRaw','ID_')  IS NOT NULL ALTER TABLE #ElementsRaw  DROP COLUMN [ID_];

{{>CalculatedPositions}}
DECLARE @EntityTypeFilter AS varchar(max) = @Container_TypeRef;
{{>LinkPowerFlow}}

{{>DriverForm}}
{{>LinkList}}

/* ---- 0. type library: one CSV for the whole page, not per hub -----------------------
   dat:types protocol (EMBEDDING.md §4a). The tool joins on ElementTypeRef and
   fills Driver Restrictions / Node Restrictions from this library wherever the
   per-hub CSV leaves them blank. One row per type+node so node-level limits are
   preserved. Sent once before dat:init — postMessage preserves order.

   Sourced from the whole page's driver rows, not the hub's, which is what lets a
   hub with no drivers be sized at all. The limit: a page where NO hub has drivers
   sends no library, and the tool then says so rather than guessing. */
DECLARE @TypesCsv varchar(max);
SELECT @TypesCsv = '"ElementTypeRef","Node","Driver Restrictions","Node Restrictions"'
+ @NL + STRING_AGG(CONVERT(varchar(max),
    '"'+REPLACE(ISNULL(t.ElementTypeRef,''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(t.Node,''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(t.[Driver Restrictions],''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(t.[Node Restrictions],''),'"','""')+'"'
  ), @NL)
FROM (SELECT DISTINCT ElementTypeRef, Node, [Driver Restrictions], [Node Restrictions]
      FROM #DriverAssignmentForm
      WHERE ISNULL(ElementTypeRef,'')<>'') t;

/* ---- 1. hubs: label (as the CSVs key on) -> Position Ref (as the overlay keys on) ----
   Pullzone in both CSVs is COALESCE(ExtRef,Ref) - the readable label. An overlay
   row must key on the Position Ref, which only resolves inside its own set. Match
   the two rather than assuming either.

   A hub is anywhere cables OR drivers live, so the two sources are UNIONed. Taking
   only the form's Pullzones hid exactly the hubs that need the tool most: a hub
   with cables and no drivers yet got no launcher, because it has no driver rows to
   be found in. That is the case the tool sizes drivers for. */
IF OBJECT_ID('tempdb..#Hubs') IS NOT NULL DROP TABLE #Hubs;
SELECT DISTINCT
       f.Pullzone                                  AS HubLabel,
       COALESCE(p.Ref, f.Pullzone)                 AS HubRef
INTO #Hubs
FROM (SELECT DISTINCT Pullzone FROM #DriverAssignmentForm WHERE ISNULL(Pullzone,'')<>''
      UNION
      SELECT DISTINCT PullZone FROM #LinkAllocation
      WHERE ISNULL(PullZone,'')<>''
        AND PullzoneTypeRef IN (SELECT TRIM(value) FROM STRING_SPLIT(@Container_TypeRef,','))) f
OUTER APPLY (
    SELECT TOP 1 p.Ref
    FROM #Positions p
    WHERE COALESCE(NULLIF(p.ExtRef,''), p.Ref) = f.Pullzone
      AND p.TypeRef IN (SELECT TRIM(value) FROM STRING_SPLIT(@Container_TypeRef,','))
) p;

/* ---- 2. the two CSVs, per hub -------------------------------------------------------
   Every field quoted and internal quotes doubled - always valid, never needs a
   delimiter test. Column order is the DataJoins' own, so an exported CSV round
   trips back into the standalone tool unchanged. Rows are CRLF separated; the
   handler asserts the line breaks survived. */
IF OBJECT_ID('tempdb..#FormCsv') IS NOT NULL DROP TABLE #FormCsv;
SELECT f.Pullzone AS HubLabel,
  '"Pullzone","ParentElementRef","ElementRef","ElementTypeRef","CurrentNodePowerInfo","Node","ToEntityType","ToEntityRefs","ControlGroup"'
+ @NL + STRING_AGG(CONVERT(varchar(max),
    '"'+REPLACE(ISNULL(CONVERT(varchar(max),f.Pullzone),''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(CONVERT(varchar(max),f.ParentElementRef),''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(CONVERT(varchar(max),f.ElementRef),''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(CONVERT(varchar(max),f.ElementTypeRef),''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(CONVERT(varchar(max),f.CurrentNodePowerInfo),''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(CONVERT(varchar(max),f.Node),''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(CONVERT(varchar(max),f.ToEntityType),''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(CONVERT(varchar(max),f.ToEntityRefs),''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(CONVERT(varchar(max),f.ControlGroup),''),'"','""')+'"'
  ), @NL) WITHIN GROUP (ORDER BY f.ElementRef, f.Node) AS Csv
INTO #FormCsv
FROM #DriverAssignmentForm f
WHERE ISNULL(f.Pullzone,'')<>''
GROUP BY f.Pullzone;

IF OBJECT_ID('tempdb..#LinkCsv') IS NOT NULL DROP TABLE #LinkCsv;
SELECT l.PullZone AS HubLabel,
  '"IsAllocated","PullZone","PullzoneTypeRef","ControlGroupText","LinkRef","LinkTypeRef",'
+ '"LinkSumPower(W)","LinkCurrent","LinkVoltage(V)","LinkForwardVoltage(Vf)","ToLocationName",'
+ '"PositionType","ThreadCount","SecondaryPowerType","ControlType"'
+ @NL + STRING_AGG(CONVERT(varchar(max),
    '"'+REPLACE(ISNULL(CONVERT(varchar(max),l.IsAllocated),''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(CONVERT(varchar(max),l.PullZone),''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(CONVERT(varchar(max),l.PullzoneTypeRef),''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(CONVERT(varchar(max),l.ControlGroupText),''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(CONVERT(varchar(max),l.LinkRef),''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(CONVERT(varchar(max),l.LinkTypeRef),''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(CONVERT(varchar(max),l.[LinkSumPower(W)]),''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(CONVERT(varchar(max),l.LinkCurrent),''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(CONVERT(varchar(max),l.[LinkVoltage(V)]),''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(CONVERT(varchar(max),l.[LinkForwardVoltage(Vf)]),''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(CONVERT(varchar(max),l.ToLocationName),''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(CONVERT(varchar(max),l.PositionType),''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(CONVERT(varchar(max),l.ThreadCount),''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(CONVERT(varchar(max),l.SecondaryPowerType),''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(CONVERT(varchar(max),l.ControlType),''),'"','""')+'"'
  ), @NL) WITHIN GROUP (ORDER BY l.LinkRef) AS Csv
INTO #LinkCsv
FROM #LinkAllocation l
WHERE l.PullzoneTypeRef IN (SELECT TRIM(value) FROM STRING_SPLIT(@Container_TypeRef,','))
  AND ISNULL(l.PullZone,'')<>''
GROUP BY l.PullZone;

/* ---- 3. the handler -----------------------------------------------------------------
   Self-built panel, not the Bootstrap modal: no dependency on SysEx modal ids,
   full width for a real application, and it cannot collide with a markdown modal
   already open. Redefined on every click - see the no-guard note in internal notes. */
DECLARE @JS varchar(max) =
 'var TOOL_ORIGIN=''' + @ToolOrigin + ''';'
+'var TOOL_PATH=''' + @ToolPath + ''';'
+'window.__datOpen=function(ref,hub,ver){'
+'var src=TOOL_ORIGIN+TOOL_PATH+''?parentOrigin=''+encodeURIComponent(location.origin);'
+'var f=document.getElementById(''datf_''+ref);'
+'var l=document.getElementById(''datl_''+ref);'
+'if(!f||!l){IWalertmessage(''No data block for ''+ref);return;}'
+'var form=f.textContent,links=l.textContent;'
 -- The CSVs must keep their line breaks. If they are ever collapsed the tool
 -- reports a column error; catch it here, where the message can name the cause.
 -- The form block is legitimately empty on a hub with no drivers, so it is only
 -- checked when it has content. Nested ifs, not && - see the note further down.
+'if(links.indexOf(''\n'')===-1){'
+'IWalertmessage(''Driver tool: links CSV for ''+ref+'' has no line breaks - check the overlay writer.'');return;}'
+'if(form!==''''){if(form.indexOf(''\n'')===-1){'
+'IWalertmessage(''Driver tool: driver CSV for ''+ref+'' has no line breaks - check the overlay writer.'');return;}}'
+'var back=document.createElement(''div'');'
+'back.style.cssText=''position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:20000'';'
+'var pan=document.createElement(''div'');'
+'pan.style.cssText=''position:fixed;top:3vh;left:3vw;right:3vw;bottom:3vh;background:#fff;'
+'border-radius:6px;z-index:20001;display:flex;flex-direction:column;overflow:hidden'';'
+'var bar=document.createElement(''div'');'
+'bar.style.cssText=''padding:6px 10px;border-bottom:1px solid #ddd;font:13px system-ui;'
+'display:flex;align-items:center;gap:10px;flex:0 0 auto'';'
+'var ti=document.createElement(''strong'');ti.textContent=''Driver assignment - ''+hub;'
+'var st=document.createElement(''span'');st.style.cssText=''color:#888'';st.textContent=''connecting...'';'
+'var xb=document.createElement(''button'');xb.textContent=''Close'';xb.className=''btn btn-outline-primary'';xb.style.cssText=''margin-left:auto'';'
+'bar.appendChild(ti);bar.appendChild(st);bar.appendChild(xb);'
+'var fr=document.createElement(''iframe'');'
+'fr.style.cssText=''flex:1 1 auto;border:0;width:100%'';'
+'fr.setAttribute(''allow'',''clipboard-write'');'
+'fr.src=src;'
+'pan.appendChild(bar);pan.appendChild(fr);'
+'document.body.appendChild(back);document.body.appendChild(pan);'
+'var dirty=0,ready=false;'
 -- If the frame never handshakes, say so rather than showing a blank panel.
 -- Usual causes: the tool has not shipped its embed entry, the origin is not in
 -- its allowlist, or the frame 404'd.
+'var watchdog=setTimeout(function(){if(!ready){st.textContent=''no response from tool - check console'';}},8000);'
+'function save(n,c){var u=URL.createObjectURL(new Blob([c],{type:''text/plain''}));'
+'var a=document.createElement(''a'');a.href=u;a.download=n;a.click();URL.revokeObjectURL(u);}'
+'function onMsg(e){'
+'if(e.source!==fr.contentWindow){return;}'
+'if(e.origin!==TOOL_ORIGIN){return;}'
+'var m=e.data;if(!m){return;}'
+'if(m.type===''dat:ready''){ready=true;clearTimeout(watchdog);st.textContent='''';'
+'var tlib=document.getElementById(''datt_''+ref);'
+'if(tlib){fr.contentWindow.postMessage({type:''dat:types'',version:1,types:tlib.textContent},TOOL_ORIGIN);}'
+'fr.contentWindow.postMessage({type:''dat:init'',version:1,'
+'form:form,links:links,focusZone:hub,'
+'context:{branchId:''' + @Branch + ''',systemSetId:ver,hubRef:ref,hubLabel:hub}},TOOL_ORIGIN);}'
+'if(m.type===''dat:dirty''){dirty=m.changeCount;st.textContent=dirty?dirty+'' unsaved'':'''';}'
+'if(m.type===''dat:error''){IWalertmessage(''Driver tool: ''+m.message);}'
+'if(m.type===''dat:export''){'
+'if(m.kind===''patch''){copyToClipboard(m.content);'
+'IWalertmessage(''Patch script copied - paste it into the Office Scripts editor'');}'
+'else{save(m.filename,m.content);IWalertmessage(''Exported ''+m.filename);}}}'
+'window.addEventListener(''message'',onMsg);'
 -- nested ifs, not &&, to keep the handler free of & for the HTML attribute
+'function shut(){if(dirty){if(!confirm(dirty+'' unsaved change(s). Close anyway?'')){return;}}'
+'clearTimeout(watchdog);window.removeEventListener(''message'',onMsg);back.remove();pan.remove();}'
+'xb.onclick=shut;back.onclick=shut;};';

/* ---- 4. overlay rows -----------------------------------------------------------------
   #SysEx_Overlay already exists and holds LinkPowerFlow's PowerData rows - we
   append rather than drop, so both sets of attributes ship in one overlay.

   The form CSV is LEFT JOINed and its block may be EMPTY - a hub with no drivers
   sends cables only and the tool sizes drivers from the type library. Empty, not
   a header row on its own: a header with no data rows is a parse error there,
   whereas blank is understood as "this hub has nothing yet". */

INSERT #SysEx_Overlay
SELECT 'Position', h.HubRef, '>DriverAssignment.Open',
   '<script type="text/plain" id="datf_'+h.HubRef+'">'+ISNULL(fc.Csv,'')+'</'+'script>'
 + '<script type="text/plain" id="datl_'+h.HubRef+'">'+ISNULL(lc.Csv,'')+'</'+'script>'
 + CASE WHEN @TypesCsv IS NOT NULL THEN '<script type="text/plain" id="datt_'+h.HubRef+'">'+@TypesCsv+'</'+'script>' ELSE '' END
 + '<a href="javascript:void(0)" class="btn btn-sm btn-primary" title="Assign drivers for this hub"'
 + ' onclick="'+@JS+'window.__datOpen('''+h.HubRef+''','''+h.HubLabel+''','''+@Ver+''');">'
 + 'Assign drivers</a>'
FROM #Hubs h
LEFT JOIN #FormCsv fc ON fc.HubLabel = h.HubLabel
LEFT JOIN #LinkCsv lc ON lc.HubLabel = h.HubLabel;

-- A count, so the panel says something even before you click.
INSERT #SysEx_Overlay
SELECT 'Position', h.HubRef, 'DriverAssignment.Scope',
       CONVERT(varchar(10),(SELECT COUNT(DISTINCT ElementRef) FROM #DriverAssignmentForm d WHERE d.Pullzone=h.HubLabel))
     + ' drivers, '
     + CONVERT(varchar(10),(SELECT COUNT(*) FROM #LinkAllocation a WHERE a.PullZone=h.HubLabel)) + ' cables'
FROM #Hubs h;

-- SQL FOOTER --
SELECT * FROM #SysEx_Overlay
