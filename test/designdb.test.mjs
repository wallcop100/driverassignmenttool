// DesignDB workbook -> type library CSV, as the overlay's section 0 would emit it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { channels, typesCsvFromSheets, positionUoms, hubsFromSheets } from '../src/designdb.js';
import * as api from '../src/api.js';
import * as engine from '../src/engine.js';

test('channels follows the overlay CASE', () => {
  assert.equal(channels('{<OP.1,<OP.2}'), 2);
  assert.equal(channels('{OP.01,OP.02,OP.03}'), 3);
  assert.equal(channels(''), 1);
});

test('keeps live drivers, parts and placed types; drops the rest', () => {
  const csv = typesCsvFromSheets({
    ElementTypes: [
      { Ref: 'ET-A', Name: 'SOLODrive 360/A', Parameters: '{<OP.1}', 'MaxPower(W)': 30, CurrentRange: 0.35 },
      { Ref: 'ET-DEL', IsDeleted: 'Y', Parameters: '{<OP.1}' },
      { Ref: 'ET-BARE', Name: 'Unfinished driver' },          // no Parameters, but placed on a hub
      { Ref: 'ET-PSU', Name: 'Supply' },                      // a part of a placed wrapper
      { Ref: 'ET-GEAR', Name: 'Gear on a non-hub' },
      { Ref: 'ET-LAMP', Name: 'Fitting' },
    ],
    Positions: [{ Ref: 'P1', Link_SecondaryPowerRef: 'HUB' }, { Ref: 'HUB' }],
    Elements: [
      { Ref: 'E1', TypeRef: 'ET-BARE', ContextType: 'Position', ContextRef: 'HUB' },
      { Ref: 'E2', TypeRef: 'ET-PSU', ContextType: 'Element', ContextRef: 'E1' },
      { Ref: 'E3', TypeRef: 'ET-GEAR', ContextType: 'Position', ContextRef: 'P1' },
    ],
  });
  const types = engine.parseTypes(csv);
  assert.deepEqual(types.map((t) => t.typeRef), ['ET-A', 'ET-BARE', 'ET-PSU']);
  const a = types[0];
  assert.equal(a.name, 'SOLODrive 360/A');
  assert.equal(a.maxPowerW, 30);
  assert.equal(a.powerType, 'CC');
  assert.equal(a.nodes.length, 1);
});

test('positionUoms: own UoM only, no ParentRef inheritance; deleted types count, live wins', () => {
  assert.deepEqual(positionUoms([
    { Ref: 'LINEAR', UoM: 'm' }, { Ref: 'C01r', UoM: '', ParentRef: 'LINEAR' }, { Ref: 'B02w', UoM: '' },
    { Ref: 'X', UoM: 'm', IsDeleted: 'Y' }, { Ref: 'P1', UoM: 'm2' },
    { Ref: 'D', UoM: 'm', IsDeleted: 'Y' }, { Ref: 'D', UoM: '' },
  ]), { LINEAR: 'm', X: 'm', P1: 'm2' });
});

// Hub Spacing from the DesignDB alone: hubs by the safer rule, each with its rows.
test('hubsFromSheets: a hub holds a driver or is named as secondary power', () => {
  const { hubs, compositions } = hubsFromSheets({
    ElementTypes: [{ Ref: 'ET-D', Parameters: '{<OP.1}' }, { Ref: 'ET-W' }, { Ref: 'ET-PSU' }, { Ref: 'ET-LAMP' }],
    Positions: [
      { Ref: 'H1', ExtRef: 'HUB-A', Parameters: '[[300mm,900mm,150mm]]<A.1[300mm,900mm,150mm,0,0,0]>' },
      { Ref: 'H2' },                                         // holds a wrapper with no outputs of its own
      { Ref: 'H3' },                                         // empty, but a fitting points at it
      { Ref: 'F1', Link_SecondaryPowerRef: 'H3' },          // a fitting with a lamp Element: not a hub
      { Ref: 'GONE', IsDeleted: 'Y' },
    ],
    Elements: [
      { Ref: 'E1', TypeRef: 'ET-D', ContextType: 'Position', ContextRef: 'H1', ContextParameters: '[50mm,25mm,0mm]<A.1>' },
      { Ref: 'E2', TypeRef: 'ET-D', ContextType: 'Position', ContextRef: 'H1', Quantity: 3 },
      { Ref: 'E3', TypeRef: 'ET-W', ContextType: 'Position', ContextRef: 'H2' },
      { Ref: 'E4', TypeRef: 'ET-PSU', ContextType: 'Element', ContextRef: 'E3', Quantity: 2, SortOrder: 1 },
      { Ref: 'E5', TypeRef: 'ET-LAMP', ContextType: 'Position', ContextRef: 'F1' },
      { Ref: 'E6', TypeRef: 'ET-D', ContextType: 'Position', ContextRef: 'GONE' },
    ],
  });
  assert.deepEqual(Object.keys(hubs).sort(), ['H2', 'H3', 'HUB-A']);
  assert.match(compositions, /ET-W,ET-PSU,2,1/);

  api.setDriverExtras({ compositions, elements: hubs });
  const a = api.hubRows('HUB-A');
  assert.equal(a.hub.ref, 'H1');
  assert.match(a.hub.parameters, /^\[\[300mm/);
  assert.deepEqual(Object.keys(a.elements), ['E1', 'E2']);
  assert.equal(a.elements.E1.contextParameters, '[50mm,25mm,0mm]<A.1>');
  assert.equal(a.elements.E2.quantity, 3);
  assert.deepEqual(Object.keys(api.hubRows('H3').elements), []);
  assert.deepEqual(api.compositions(), { 'ET-W': [{ typeRef: 'ET-PSU', quantity: 2 }] });
  api.setDriverExtras();

  const m = engine.buildEmpty(Object.keys(hubs).sort(), 'ElementTypeRef,ElementTypeName,Parameters\nET-D,Driver,{<OP.1}\n');
  assert.deepEqual(m.zones, ['H2', 'H3', 'HUB-A']);
  assert.equal(m.mode, 'empty');
});
