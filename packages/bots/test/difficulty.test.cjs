const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const { BOT_PRESETS } = require('../src/difficulty.ts');

test('online hard bot preset uses a gentler 1000 ms action delay', () => {
  assert.equal(BOT_PRESETS.hard.actionDelayMs, 1000);
});
