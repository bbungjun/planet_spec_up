import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rawNumericText} from './value-text.mjs';
test('preserves non-digit evidence and cannot drop an invalid leading character',()=>{
  assert.equal(rawNumericText('REQ STR: O0','whole-row','requirement'),'O0');
  assert.equal(rawNumericText('REQ STR: 1 0','whole-row','requirement'),'1 0');
  assert.equal(rawNumericText('REQ STR: 1:0','whole-row','requirement'),null);
  assert.equal(rawNumericText('O','number-tight','requirement'),'O');
  assert.equal(rawNumericText('0','number-fixed-canvas','requirement'),'0');
});
test('compares numeric values without requiring the whole-row label to be correct',()=>{
  assert.equal(rawNumericText('FIEQ STR: 0','whole-row','requirement'),'0');
  assert.equal(rawNumericText('REQ STR0','whole-row','requirement'),'0');
  assert.equal(rawNumericText('REQ LEV: 100','whole-row','requirement'),'100');
  assert.equal(rawNumericText('DEX: +8','whole-row','bonus'),'8');
  assert.equal(rawNumericText('+23','number-tight','bonus'),'23');
});
