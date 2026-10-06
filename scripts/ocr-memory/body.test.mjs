import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readJsonBody } from './body.mjs';

test('preserves Korean evidence across every possible UTF-8 chunk boundary', async () => {
  const expected = { text: '요구 레벨 · 공격력 +13 · DEX +7%', reason: '검토 필요', fields: { attack: '13' } };
  const bytes = Buffer.from(JSON.stringify(expected));
  for (let split = 1; split < bytes.length; split++) {
    assert.deepEqual(await readJsonBody(Readable.from([bytes.subarray(0, split), bytes.subarray(split)])), expected);
  }
  assert.deepEqual(await readJsonBody(Readable.from([...bytes].map(byte => Buffer.from([byte])))), expected);
});

test('bounds bytes instead of characters and rejects malformed receipts', async () => {
  await assert.rejects(readJsonBody(Readable.from([Buffer.from('"한글"')]), 7), /Payload too large/);
  await assert.rejects(readJsonBody(Readable.from([Buffer.from('{broken')])), SyntaxError);
});
