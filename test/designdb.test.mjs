// DesignDB workbook -> type library CSV, as the overlay's section 0 would emit it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { channels, typesCsvFromSheets, positionUoms } from '../src/designdb.js';
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

test('positionUoms: live PositionTypes with a UoM only', () => {
  assert.deepEqual(positionUoms([
    { Ref: 'C01r', UoM: 'm' }, { Ref: 'B02w', UoM: '' }, { Ref: 'X', UoM: 'm', IsDeleted: 'Y' }, { Ref: 'P1', UoM: 'm2' },
  ]), { C01r: 'm', P1: 'm2' });
});
