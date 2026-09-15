// The ExcelScript emitter, as both tools will share it. These assert the house
// rules from page 138351 hold regardless of what is being patched.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as patch from '../../src/core/patch.js';

test('a script signs itself with the tool that wrote it', () => {
  assert.match(patch.script(''), /^\/\/ Lighting DesignDB patch - Driver Assignment Tool\n/);
  assert.match(patch.script('', 'LCP Assignment Tool'),
    /^\/\/ Lighting DesignDB patch - LCP Assignment Tool\n/);
});

test('every script is one main() in a try/catch', () => {
  const s = patch.script('    // body\n');
  assert.equal(s.split('function main(').length - 1, 1, 'exactly one main()');
  assert.match(s, /try \{/);
  assert.match(s, /catch \(e\) \{[\s\S]*throw e;/);
  assert.match(s, /console\.log\("Patch complete\."\)/);
});

test('columns are found by header, never by number, and addable ones are added', () => {
  // `addable` marks which of `cols` may be appended to a workbook that lacks
  // them — a pre-V4.6 book has no ContextParameters column to find at all
  const h = patch.header('Elements', 'E', ['Ref', 'TypeRef', 'ContextParameters'],
    ['ContextParameters']);
  assert.match(h, /columnIndex\(WS_E, "Ref", false\)/);
  assert.match(h, /columnIndex\(WS_E, "ContextParameters", true\)/, 'addable');
  assert.doesNotMatch(h, /getCell\(\d+, \d+\)/, 'nothing hard-coded by position');
  // and the used range is read once, outside any loop
  assert.equal(h.split('getUsedRange()').length - 1, 1);
});

test('a value is cleared, never set to an empty string', () => {
  const body = patch.linkSection([{ ref: 'L1', type: 'Element', to: 'E1', node: '' }])
    + patch.deleteSection(['E9'], []);
  assert.doesNotMatch(body, /setValue\(""\)/);
  assert.match(body, /clear\(ExcelScript\.ClearApplyTo\.contents\)/);
});

test('writing data on a row clears that row IsPropertiesTBC', () => {
  assert.match(patch.linkSection([{ ref: 'L1', type: 'Element', to: 'E1', node: 'OP.1' }]),
    /col_X_IsPropertiesTBC\)\.clear/);
});

test('an omit cascades to child Elements and to LinksMap', () => {
  const s = patch.deleteSection(['E1'], []);
  assert.match(s, /ContextType/, 'children of the omitted row');
  assert.match(s, /IsDeleted/);
});
