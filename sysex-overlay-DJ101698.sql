-- SysEx Overlay - Lighting Interactive LCP --
-- V0.2 -- (DJ 101698 "Interactive LCP": V0.2 live as revision 10)

--SQL HEADER--
DECLARE @PanelTypes       AS nvarchar(400) = N'LCP';       -- comma separated patterns against the panel ElementType Ref. KEEP nvarchar(400): max breaks the run page parameter parser (DJ 101676 V0.6)
DECLARE @SystemBranchID   AS INT          = 10358;         -- only used when @SystemSetID = 0
DECLARE @SystemSetID      AS INT          = 0;             -- 0 = latest committed set of @SystemBranchID


-- SQL BODY ---

DECLARE @ToolOrigin       AS varchar(200) = 'https://wallcop100.github.io';
DECLARE @ToolPath         AS varchar(200) = '/driverassignmenttool/lcp/api/';
DECLARE @DataVersion      AS varchar(50)  = '';            -- blank = @SystemSetID
-- NOT WIRED IN. See section 4: the fittings that carry the loops are on a
-- different branch from the panels, and one DataJoin rehydrates one set.
DECLARE @LoopSetID        AS INT          = 0;

-- Sibling of DJ 101681 (Driver Assignment) and DJ 101676 (LCP Panel Layout
-- Modal). 101676 DRAWS a panel and stops; this one hands the same panel to an
-- editor and takes the changes back. It follows 101681's shape exactly - script
-- blocks of CSV plus a launcher - so there is one overlay pattern to maintain,
-- not two.
--
-- The message prefix is lcp:, not dat:. Both tools can be embedded in one page
-- and the first frame to answer would otherwise swallow the other's init.

DECLARE @NL varchar(2) = CHAR(13)+CHAR(10);

-- Header DECLAREs become this DataJoin's PARAMETER SET and the stored value wins
-- over the literal. Test for a valid absolute origin, not just for blank: a
-- stored '/' is non-blank and produces src='//driver...'.
IF LEFT(ISNULL(@ToolOrigin,''),4) <> 'http' SET @ToolOrigin = 'https://wallcop100.github.io';
IF LEFT(ISNULL(@ToolPath,''),1)   <> '/'    SET @ToolPath   = '/driverassignmenttool/lcp/api/';
SET @ToolOrigin = LEFT(@ToolOrigin, LEN(@ToolOrigin) - CASE WHEN RIGHT(@ToolOrigin,1)='/' THEN 1 ELSE 0 END);
WHILE LEFT(@ToolPath,2) = '//' SET @ToolPath = RIGHT(@ToolPath, LEN(@ToolPath)-1);
-- Panel identification is name based and the naming is inconsistent across the
-- estate - ET-LCP5-Panel, ET-1DinLCPPanel, ET-LSC-PANEL-4DIN, ET-4-DIN-PANEL.
-- 101676 hit the same wall and solved it the same way: the caller says which.
IF ISNULL(@PanelTypes,'') = '' SET @PanelTypes = 'LCP';

IF ISNULL(@SystemSetID,0) = 0 AND ISNULL(@SystemBranchID,0) <> 0
    SET @SystemSetID = (SELECT TOP 1 SystemSetID FROM SystemSets
                        WHERE SystemBranchID = @SystemBranchID ORDER BY Added DESC);
IF ISNULL(@SystemBranchID,0) = 0
    SET @SystemBranchID = (SELECT TOP 1 SystemBranchID FROM SystemSets
                           WHERE SystemSetID = @SystemSetID);
DECLARE @Ver    varchar(50) = ISNULL(NULLIF(@DataVersion,''), CONVERT(varchar(50), @SystemSetID));
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
{{>ElementTopLevelContext}}


/* ---- 1. the panels ------------------------------------------------------------------
   A panel is an ELEMENT, not a Position: on project 5294, E08001 is an
   ET-LCP5-Panel Element sitting on a Position, and its modules are Elements
   contexted into it. So the overlay rows below are EntityClass 'Element'.

   The panel type's Parameters carry the slot recipe - <01,02,..,LB1,P1> - which
   is what the tool draws the ways from. A panel type with no recipe declares no
   ways; 101676 skips those entirely rather than guessing, and so does this. */
IF OBJECT_ID('tempdb..#LcpPanels') IS NOT NULL DROP TABLE #LcpPanels;
SELECT
       E.Ref                                   AS PanelRef,
       COALESCE(NULLIF(E.Name,''), E.Ref)      AS PanelName,
       E.TypeRef                               AS PanelTypeRef,
       ISNULL(ET.Parameters,'')                AS PanelParameters
INTO   #LcpPanels
FROM   #ElementsRaw E
LEFT JOIN #ElementTypes ET ON ET.Ref = E.TypeRef
WHERE  EXISTS (SELECT 1 FROM STRING_SPLIT(@PanelTypes, ',') p
               WHERE E.TypeRef LIKE '%' + TRIM(p.value) + '%')
  -- a panel with nothing in it has nothing to arrange or assign
  AND  EXISTS (SELECT 1 FROM #ElementsRaw M
               WHERE M.ContextType = 'Element' AND M.ContextRef = E.Ref);


/* ---- 2. the modules -----------------------------------------------------------------
   One row per module, carrying its panel denormalised - the same shape the
   driver form uses, where every driver row repeats its Pullzone.

   ContextParameters is the WAY the module sits in: <03>, or <01.a> and <01.b>
   for two modules sharing way 01, or <3.1> where dot syntax groups. It is sent
   exactly as written; the tool folds the grouping, not this. On the project 5294
   Lighting branch (10359) it is empty on all 183 modules while the LSC branch
   (10358) has every one filled in - which is the arrangement work the tool is
   for, and why the column is sent even when blank. */
IF OBJECT_ID('tempdb..#LcpModules') IS NOT NULL DROP TABLE #LcpModules;
SELECT
       P.PanelRef, P.PanelName, P.PanelTypeRef, P.PanelParameters,
       M.Ref                                   AS ElementRef,
       M.TypeRef                               AS ElementTypeRef,
       -- The NAME is what says who made a module, and the maker decides which
       -- ratings apply: ET-MOD-PHASE is a Crestron DIN-1DIMU4 on 5294 and could
       -- be a Lutron LQSE-4A5 elsewhere. Sending a blank name costs the tool
       -- every output limit it could have checked, so the type's name is used
       -- when the element has none of its own.
       COALESCE(NULLIF(M.Name,''), NULLIF(MT.Name,''), '') AS ElementName,
       ISNULL(M.ContextParameters,'')          AS ContextParameters,
       M.SortOrder
INTO   #LcpModules
FROM   #ElementsRaw M
JOIN   #LcpPanels P   ON P.PanelRef = M.ContextRef AND M.ContextType = 'Element'
LEFT JOIN #ElementTypes MT ON MT.Ref = M.TypeRef;


/* ---- 3. the module type library ----------------------------------------------------
   Parameters is the whole point of the row: {<A(DA1),<B(DA2),>LINK} is what a
   cable can land on. Sent once for the page, as 101681 sends its driver library,
   so a panel can be given a module type it does not already contain.

   Only types actually used in a panel, plus anything whose Ref looks like a
   module - a module library the size of the whole ElementTypes table would be
   sent to every panel on the page for no gain. */
DECLARE @TypesCsv varchar(max);
SELECT @TypesCsv = '"Ref","Name","Parameters"'
+ @NL + STRING_AGG(CONVERT(varchar(max),
    '"'+REPLACE(ISNULL(t.Ref,''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(t.Name,''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(t.Parameters,''),'"','""')+'"'
  ), @NL) WITHIN GROUP (ORDER BY t.Ref)
FROM (SELECT DISTINCT ET.Ref, ET.Name, ET.Parameters
      FROM #ElementTypes ET
      WHERE ET.Ref IN (SELECT ElementTypeRef FROM #LcpModules)
         OR ET.Ref LIKE '%-MOD-%' OR ET.Ref LIKE 'ET-MOD%') t;


/* ---- 4. the loop, and what is on it -------------------------------------------------
   Link_ControlDetails is the loop, and it is an INHERITED position attribute -
   reading a link's own row for it returns nothing. The loop of a cable is the
   loop of the fittings at its far end, resolved through #CalculatedPositions.
   This is the single thing the tool cannot work out for itself: it is sent one
   panel, and a loop runs across the whole design.

   MEASURED, AND IT IS A REAL LIMIT: on the sets that hold LCP panels, the
   fittings are not there to ask.

     109287  project 5294  "Part 2/3 - LSC + S"   14 panels, 191 modules
                                                323 positions, ALL blank
                                                ControlTypeRef, 0 loops
     109311  project 5294  "Part 3/3 - L"         0 modules in a way
                                                1,139 DALI positions, 24 loops
     108962  branch 10328                       31 panels, 0 loops

   The panels live on the LSC branch and the fittings on the Lighting branch of
   the same merged system, so ONE @SystemSetID cannot supply both halves. The
   loop, group, load and ballast columns below therefore come out BLANK on a
   panel-bearing set, and that is the honest answer rather than a bug to hide:
   the tool then shows run counts and no loop chips. @LoopSetID is left as a
   parameter for the day this is solved - a second {{>SystemSetDesignDB}} in one
   DataJoin is not available, so it is NOT wired in yet and setting it does
   nothing. Do not let it look as if it does.

   Ballasts and fitting counts follow DJ 101269 "Intermediate Ballast Count
   Check", which is the authority. Two sources, as 101269 has them:
     a) DALI positions on the loop      BallastCountPerUoM x Quantity
     b) driver Elements under positions fed by a secondary power ref
   Neither is a count of cables. 101269 reports the number and sets no
   threshold - the 64 the tool draws a gauge against is the DALI address limit
   (0-63), not a house rule, and the tool says so. */
IF OBJECT_ID('tempdb..#LoopBallasts') IS NOT NULL DROP TABLE #LoopBallasts;
SET ANSI_WARNINGS OFF;
SELECT
       CP.Link_ControlDetails                                          AS Loop,
       SUM(COALESCE(P.BallastCount, PT.BallastCountPerUoM * CP.Quantity)) AS Ballasts,
       COUNT(DISTINCT CP.PositionRef)                                  AS Fittings
INTO   #LoopBallasts
FROM   #CalculatedPositions CP
LEFT JOIN #PositionTypes PT ON CP.PositionTypeRef = PT.Ref
LEFT JOIN #PositionsRaw  P  ON CP.PositionRef = P.Ref
WHERE  CP.ControlTypeRef LIKE '%DALI%'
  AND  CP.IsParent = '0'
  AND  ISNULL(CP.Link_SecondaryPowerRef,'0') = '0'
  AND  ISNULL(P.IsDeleted,'0') = '0'
  AND  CP.Quantity > 0
  AND  ISNULL(CP.Link_ControlDetails,'') <> ''
GROUP BY CP.Link_ControlDetails;

-- (b) DJ 101269's second branch, VERBATIM. An earlier version joined drivers to
-- their direct ContextRef and required a loop name; 101269 walks each Element up
-- to its TOP-LEVEL position and names the loop from that position's
-- Link_ControlDetails, falling back to its ExtRef or Ref. Measured on set 109311
-- the shortcut matched 101269 on 22 loops and lost U3A (16) and U3B (15) entirely.
INSERT #LoopBallasts (Loop, Ballasts, Fittings)
SELECT COALESCE(CP.Link_ControlDetails, CP.PositionExtRef, CP.PositionRef),
       SUM(ET.BallastCountPerUoM * COALESCE(E.Quantity, 1)),
       COUNT(DISTINCT CP.PositionRef)
FROM   #Elements E
OUTER APPLY (SELECT TopLevel FROM #ElementTopLevelContext ETL WHERE E.Ref = ETL.Ref) ETL
LEFT JOIN #ElementTypes ET ON ET.Ref = E.TypeRef
LEFT JOIN #CalculatedPositions CP ON CP.PositionRef = ETL.TopLevel
WHERE  CP.IsLink_SecondaryPowerRef = '1'
  AND  CP.IsParent = '0'
  AND  ISNULL(E.IsDeleted, '0') = '0'
  AND  CP.Quantity > 0
GROUP BY CP.Link_ControlDetails, CP.PositionExtRef, CP.PositionRef;

-- and the control groups on each loop, counted 101269's way: a group named after
-- its own loop is not a separate group, and counting it reports a fault one
-- short of the real 16.
IF OBJECT_ID('tempdb..#LoopGroups') IS NOT NULL DROP TABLE #LoopGroups;
SELECT CP.Link_ControlDetails AS Loop,
       COUNT(DISTINCT P.ControlGroupText) AS ControlGroups
INTO   #LoopGroups
FROM   #CalculatedPositions CP
OUTER APPLY (SELECT ControlGroupText FROM #PositionsRaw PR WHERE PR.Ref = CP.PositionRef) P
WHERE  ISNULL(P.ControlGroupText,'') <> ''
  AND  P.ControlGroupText <> CP.Link_ControlDetails
  AND  ISNULL(CP.Link_ControlDetails,'') <> ''
GROUP BY CP.Link_ControlDetails;


/* ---- 5. the cables ------------------------------------------------------------------
   A row per cable landing on a module of this panel. Either END may be the
   module: a driver cable is written FROM the driver, while the DALI loops on
   set 108908 converge on the module as their TO end - X504505 "15.1B" has
   50 from-ends on fittings and every to-end on one module output. So both are
   tried and the terminal is whichever end matched.

   A DALI loop is ONE link carrying many fittings, not one link per run, which is
   why Devices and Ballasts below are properties of the LOOP and repeat across
   the rows that share it. The tool draws a gauge from them and never computes
   them itself. */
IF OBJECT_ID('tempdb..#LcpLinks') IS NOT NULL DROP TABLE #LcpLinks;
SELECT
       M.PanelRef,
       L.Ref                                   AS LinkRef,
       ISNULL(L.Name,'')                       AS LinkName,
       M.ElementRef                            AS ToElementRef,
       -- the terminal, with the Parameter Syntax braces stripped: {A} -> A
       REPLACE(REPLACE(ISNULL(CASE WHEN L.ToLinkEndContextRef   = M.ElementRef
                                   THEN L.ToLinkEndContextParameters
                                   ELSE L.FromLinkEndContextParameters END,''),'{',''),'}','')
                                               AS ToNode,
       ISNULL(L.TypeRef,'')                    AS LinkTypeRef,
       ISNULL(L.TopologyNotesText,'')          AS Topology,
       far.Loop,
       far.ControlGroup,
       far.ControlType,
       far.LoadW
INTO   #LcpLinks
FROM   #LinksMap L
JOIN   #LcpModules M
       ON  M.ElementRef IN (L.FromLinkEndContextRef, L.ToLinkEndContextRef)
OUTER APPLY (
       -- the FAR end of the cable: the fittings it serves. Their resolved
       -- Link_ControlDetails is the loop, their ControlGroupText the group, and
       -- their load is what an output limit is checked against.
       SELECT TOP 1
              CP.Link_ControlDetails AS Loop,
              PR.ControlGroupText    AS ControlGroup,
              CP.ControlTypeRef      AS ControlType,
              CONVERT(decimal(12,1), CP.PositionLoad) AS LoadW
       FROM   #CalculatedPositions CP
       LEFT JOIN #PositionsRaw PR ON PR.Ref = CP.PositionRef
       WHERE  CP.PositionRef = CASE WHEN L.ToLinkEndContextRef = M.ElementRef
                                    THEN L.FromLinkEndContextRef
                                    ELSE L.ToLinkEndContextRef END
) far
WHERE  ISNULL(L.IsDeleted,'') = '';


/* ---- 6. one CSV per panel -----------------------------------------------------------*/
IF OBJECT_ID('tempdb..#ModuleCsv') IS NOT NULL DROP TABLE #ModuleCsv;
SELECT m.PanelRef,
  '"ElementRef","ElementTypeRef","ElementName","PanelRef","PanelName","PanelTypeRef",'
+ '"PanelParameters","ContextParameters"'
+ @NL + STRING_AGG(CONVERT(varchar(max),
    '"'+REPLACE(m.ElementRef,'"','""')+'",'
  + '"'+REPLACE(m.ElementTypeRef,'"','""')+'",'
  + '"'+REPLACE(m.ElementName,'"','""')+'",'
  + '"'+REPLACE(m.PanelRef,'"','""')+'",'
  + '"'+REPLACE(m.PanelName,'"','""')+'",'
  + '"'+REPLACE(m.PanelTypeRef,'"','""')+'",'
  + '"'+REPLACE(m.PanelParameters,'"','""')+'",'
  + '"'+REPLACE(m.ContextParameters,'"','""')+'"'
  ), @NL) WITHIN GROUP (ORDER BY m.SortOrder, m.ElementRef) AS Csv
INTO #ModuleCsv
FROM #LcpModules m
GROUP BY m.PanelRef;

IF OBJECT_ID('tempdb..#LinkCsv') IS NOT NULL DROP TABLE #LinkCsv;
SELECT l.PanelRef,
  '"LinkRef","LinkName","PanelRef","ToElementRef","ToNode","ControlGroup","Loop",'
+ '"ControlType","LoadW","Devices","Ballasts","Topology"'
+ @NL + STRING_AGG(CONVERT(varchar(max),
    '"'+REPLACE(l.LinkRef,'"','""')+'",'
  + '"'+REPLACE(l.LinkName,'"','""')+'",'
  + '"'+REPLACE(l.PanelRef,'"','""')+'",'
  + '"'+REPLACE(l.ToElementRef,'"','""')+'",'
  + '"'+REPLACE(l.ToNode,'"','""')+'",'
  + '"'+REPLACE(ISNULL(l.ControlGroup,''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(l.Loop,''),'"','""')+'",'
  + '"'+REPLACE(ISNULL(l.ControlType,''),'"','""')+'",'
  + '"'+ISNULL(CONVERT(varchar(20),l.LoadW),'')+'",'
  + '"'+ISNULL(CONVERT(varchar(20),b.Fittings),'')+'",'
  + '"'+ISNULL(CONVERT(varchar(20),b.Ballasts),'')+'",'
  + '"'+REPLACE(l.Topology,'"','""')+'"'
  ), @NL) WITHIN GROUP (ORDER BY l.ToElementRef, l.ToNode, l.LinkRef) AS Csv
INTO #LinkCsv
FROM #LcpLinks l
LEFT JOIN (SELECT Loop, SUM(Ballasts) AS Ballasts, SUM(Fittings) AS Fittings
           FROM #LoopBallasts
           WHERE Ballasts > 0 AND ISNULL(Loop,'0') <> '0'   -- as 101269's #PreReport
           GROUP BY Loop) b ON b.Loop = l.Loop
GROUP BY l.PanelRef;


/* ---- 7. the handler -----------------------------------------------------------------
   101681's panel, with lcp: in place of dat:. Redefined on every click, as there.*/
DECLARE @JS varchar(max) =
 'var LCP_ORIGIN=''' + @ToolOrigin + ''';'
+'var LCP_PATH=''' + @ToolPath + ''';'
+'window.__lcpOpen=function(ref,label,ver){'
+'var src=LCP_ORIGIN+LCP_PATH+''?parentOrigin=''+encodeURIComponent(location.origin);'
+'var mo=document.getElementById(''lcpm_''+ref);'
+'var li=document.getElementById(''lcpl_''+ref);'
+'if(!mo){IWalertmessage(''No module data for ''+ref);return;}'
+'var mods=mo.textContent,links=li?li.textContent:'''';'
 -- The CSVs must keep their line breaks. Collapsed, the tool reports a column
 -- error; catch it here, where the message can name the cause.
+'if(mods.indexOf(''\n'')===-1){'
+'IWalertmessage(''LCP tool: module CSV for ''+ref+'' has no line breaks - check the overlay writer.'');return;}'
+'if(links!==''''){if(links.indexOf(''\n'')===-1){'
+'IWalertmessage(''LCP tool: link CSV for ''+ref+'' has no line breaks - check the overlay writer.'');return;}}'
+'var back=document.createElement(''div'');'
+'back.style.cssText=''position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:20000'';'
+'var pan=document.createElement(''div'');'
+'pan.style.cssText=''position:fixed;top:3vh;left:3vw;right:3vw;bottom:3vh;background:#fff;'
+'border-radius:6px;z-index:20001;display:flex;flex-direction:column;overflow:hidden'';'
+'var bar=document.createElement(''div'');'
+'bar.style.cssText=''padding:6px 10px;border-bottom:1px solid #ddd;font:13px system-ui;'
+'display:flex;align-items:center;gap:10px;flex:0 0 auto'';'
+'var ti=document.createElement(''strong'');ti.textContent=''LCP - ''+label;'
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
+'var watchdog=setTimeout(function(){if(!ready){st.textContent=''no response from tool - check console'';}},8000);'
+'function save(n,c){var u=URL.createObjectURL(new Blob([c],{type:''text/plain''}));'
+'var a=document.createElement(''a'');a.href=u;a.download=n;a.click();URL.revokeObjectURL(u);}'
+'function onMsg(e){'
+'if(e.source!==fr.contentWindow){return;}'
+'if(e.origin!==LCP_ORIGIN){return;}'
+'var m=e.data;if(!m){return;}'
+'if(m.type===''lcp:ready''){ready=true;clearTimeout(watchdog);st.textContent='''';'
+'var tlib=document.getElementById(''lcpt_''+ref);'
+'if(tlib){fr.contentWindow.postMessage({type:''lcp:types'',version:1,types:tlib.textContent},LCP_ORIGIN);}'
+'fr.contentWindow.postMessage({type:''lcp:init'',version:1,'
+'modules:mods,links:links,focusZone:ref,'
 -- hubContextType says what the panel IS. A panel is an Element here, and the
 -- patch writes ContextType from it rather than assuming Position.
+'context:{branchId:''' + @Branch + ''',systemSetId:ver,hubRef:ref,hubLabel:label,'
+'hubContextType:''Element''}},LCP_ORIGIN);}'
+'if(m.type===''lcp:dirty''){dirty=m.changeCount;st.textContent=dirty?dirty+'' unsaved'':'''';}'
+'if(m.type===''lcp:error''){IWalertmessage(''LCP tool: ''+m.message);}'
+'if(m.type===''lcp:export''){'
+'if(m.kind===''patch''){copyToClipboard(m.content);'
+'IWalertmessage(''Patch script copied - paste it into the Office Scripts editor'');}'
+'else{save(m.filename,m.content);IWalertmessage(''Exported ''+m.filename);}}}'
+'window.addEventListener(''message'',onMsg);'
 -- nested ifs, not &&, to keep the handler free of & for the HTML attribute
+'function shut(){if(dirty){if(!confirm(dirty+'' unsaved change(s). Close anyway?'')){return;}}'
+'clearTimeout(watchdog);window.removeEventListener(''message'',onMsg);back.remove();pan.remove();}'
+'xb.onclick=shut;back.onclick=shut;};';


/* ---- 8. overlay rows ----------------------------------------------------------------
   EntityClass 'Element' - the panel is an Element. Unlike 101681, nothing
   earlier in this DataJoin writes overlay rows (there is no LinkPowerFlow
   include), so the table is created here, fresh, in DJ 101676's shape. */
-- The shape DJ 101676 creates, AttributeMarkdown included: SysEx reads that
-- column even when an overlay leaves it NULL, and a four-column table is not the
-- table it expects.
IF OBJECT_ID('tempdb..#SysEx_Overlay') IS NOT NULL DROP TABLE #SysEx_Overlay;
CREATE TABLE #SysEx_Overlay (
    EntityClass       nvarchar(20)  NOT NULL,
    EntityRef         nvarchar(100) NOT NULL,
    AttributeName     nvarchar(128) NOT NULL,
    AttributeValue    nvarchar(max) NULL,
    AttributeMarkdown nvarchar(max) NULL
);

INSERT #SysEx_Overlay (EntityClass, EntityRef, AttributeName, AttributeValue)
SELECT 'Element', p.PanelRef, '>LCP.Open',
   '<script type="text/plain" id="lcpm_'+p.PanelRef+'">'+ISNULL(mc.Csv,'')+'</'+'script>'
 + '<script type="text/plain" id="lcpl_'+p.PanelRef+'">'+ISNULL(lc.Csv,'')+'</'+'script>'
 + CASE WHEN @TypesCsv IS NOT NULL THEN '<script type="text/plain" id="lcpt_'+p.PanelRef+'">'+@TypesCsv+'</'+'script>' ELSE '' END
 + '<a href="javascript:void(0)" class="btn btn-sm btn-primary" title="Arrange and assign this panel"'
 + ' onclick="'+@JS+'window.__lcpOpen('''+p.PanelRef+''','''+REPLACE(p.PanelName,'''','')+''','''+@Ver+''');">'
 + 'Open panel</a>'
FROM #LcpPanels p
LEFT JOIN #ModuleCsv mc ON mc.PanelRef = p.PanelRef
LEFT JOIN #LinkCsv   lc ON lc.PanelRef = p.PanelRef;

-- Say plainly when the loops are absent, so nobody reads blank chips as "this
-- panel has no control intent" when the truth is "that is on the other branch".
DECLARE @HasLoops bit =
  CASE WHEN EXISTS (SELECT 1 FROM #CalculatedPositions
                    WHERE ISNULL(Link_ControlDetails,'') <> '') THEN 1 ELSE 0 END;
IF @HasLoops = 0
  PRINT 'NOTE: this set carries no Link_ControlDetails on any position, so Loop, '
      + 'ControlGroup, Load and Ballast columns are sent blank. On a merged system '
      + 'the panels are on the LSC branch and the fittings on the Lighting branch.';

INSERT #SysEx_Overlay (EntityClass, EntityRef, AttributeName, AttributeValue)
SELECT 'Element', p.PanelRef, 'LCP.LoopData',
       CASE WHEN @HasLoops = 1 THEN 'loops resolved from this set'
            ELSE 'no loop data in this set - fittings are on the Lighting branch' END
FROM #LcpPanels p;

-- A count, so the panel says something before you click - and it says how much
-- of the arrangement is missing, because that is the work this tool exists for.
INSERT #SysEx_Overlay (EntityClass, EntityRef, AttributeName, AttributeValue)
SELECT 'Element', p.PanelRef, 'LCP.Scope',
       CONVERT(varchar(10),(SELECT COUNT(*) FROM #LcpModules m WHERE m.PanelRef = p.PanelRef))
     + ' modules, '
     + CONVERT(varchar(10),(SELECT COUNT(*) FROM #LcpModules m
                            WHERE m.PanelRef = p.PanelRef AND m.ContextParameters <> ''))
     + ' in a way, '
     + CONVERT(varchar(10),(SELECT COUNT(*) FROM #LcpLinks l WHERE l.PanelRef = p.PanelRef))
     + ' cables'
FROM #LcpPanels p;

-- SQL FOOTER --
SELECT * FROM #SysEx_Overlay
