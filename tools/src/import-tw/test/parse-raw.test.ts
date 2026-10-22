import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchRawFileName, parseRawFromDir, parseRawText, TwParseError } from '../parse-raw.js';
import { FIXTURE_TEXTASSETS, readExpected } from './helpers.js';

const FIXTURES: [asset: string, expected: string][] = [
  ['LevelView 1', 'levelview-1.ext.json'], // position 4: base houses + 1 tower
  ['LevelView 3_AB', 'levelview-3-ab.ext.json'], // position 6: 3 AIs, delay + create-way scripts, obstacle, tower
  ['LevelView 8_ES', 'levelview-8-es.ext.json'], // position 11: action-step (AiSC) script, 2 obstacles
];

for (const [asset, expected] of FIXTURES) {
  test(`parseRaw ${asset}: fixture parses without the extract and equals the converted/ext reference`, () => {
    assert.deepEqual(parseRawFromDir(FIXTURE_TEXTASSETS, asset), readExpected(expected));
  });
}

test('parseRaw LevelView 1: typed values (players, order, rotation inputs untouched)', () => {
  const lv = parseRawFromDir(FIXTURE_TEXTASSETS, 'LevelView 1');
  assert.deepEqual(lv.players.map((p) => p.type), ['player', 'ai', 'neutral']);
  assert.deepEqual(lv.buildings.map((b) => [b.id, b.owner, b.kind]), [[0, 0, 'house'], [1, 1, 'house'], [2, 2, 'house'], [3, 2, 'house'], [4, 2, 'tower']]);
  assert.deepEqual(lv.buildings[0]?.pos, [-0.1, 0, -6.79]);
  assert.equal(lv.source.dialect, 'v1-short');
  assert.equal(lv.category, 'campaign');
  assert.equal(lv.mapObjects.cargo.length, 2);
});

test('fixture with scripts and obstacles keeps AI steps and OBS fields', () => {
  const lv = parseRawFromDir(FIXTURE_TEXTASSETS, 'LevelView 8_ES');
  const ai = lv.players.find((p) => p.ai)?.ai;
  assert.equal(ai?.steps.actionSteps?.length, 1);
  assert.equal(lv.mapObjects.obstacles.length, 2);
  assert.equal(lv.mapObjects.obstacles[0]?.childPos.length, lv.mapObjects.obstacles[0]?.active.length);
});

test('file match is anchored on the signed integer suffix', () => {
  const names = ['LevelView 1_-5730288583589927379.json', 'LevelView 1_AB_-4335602181598050449.json', 'LevelView 1_1_ESplayableads_-659713094089915949.json', 'LevelView 10_77.json'];
  assert.equal(matchRawFileName(names, 'LevelView 1'), 'LevelView 1_-5730288583589927379.json');
  assert.equal(matchRawFileName(names, 'LevelView 10'), 'LevelView 10_77.json');
});

test('0 matches and >1 matches are errors', () => {
  assert.throws(() => matchRawFileName(['LevelView 1_AB_5.json'], 'LevelView 1'), (e) => e instanceof TwParseError && /no raw TextAsset file/.test(e.message));
  assert.throws(() => matchRawFileName(['LevelView 1_5.json', 'LevelView 1_-6.json'], 'LevelView 1'), (e) => e instanceof TwParseError && /ambiguous/.test(e.message));
  assert.throws(() => parseRawFromDir(FIXTURE_TEXTASSETS, 'LevelView 999'), /no raw TextAsset file/);
});

test('asset names are matched literally (regex metacharacters)', () => {
  assert.throws(() => matchRawFileName(['LevelViewX1_5.json'], 'LevelView.1'), /no raw/);
});

const v1 = (): Record<string, unknown> => JSON.parse(readFileSync(join(FIXTURE_TEXTASSETS, 'LevelView 1_-5730288583589927379.json'), 'utf8')) as Record<string, unknown>;

test('v0 dialect is refused explicitly', () => {
  assert.throws(() => parseRawText('LevelView 7', JSON.stringify({ Player: { PT: 0, PC: 0 }, AI: [] })), /v0 dialect.*not supported/);
});

test('long dialect is refused explicitly', () => {
  const d = v1() as { P: { BD: Record<string, unknown>[] }[] };
  d.P[0]!.BD[0] = { Id: 0, BuildingsType: 0, Position: { X: 0, Y: 0, Z: 0 }, key: 'h' };
  assert.throws(() => parseRawText('LevelView 7', JSON.stringify(d)), /long dialect.*not supported/);
});

test('boss family and boss player are refused', () => {
  assert.throws(() => parseRawText('LevelViewBoss 5_3ES', JSON.stringify(v1())), /boss level/);
  const d = v1() as { P: { PT: number; key: string }[] };
  d.P[1]!.PT = 3;
  d.P[1]!.key = 'b_p';
  assert.throws(() => parseRawText('LevelView 7', JSON.stringify(d)), /boss player/);
});

test('unknown dialect and malformed input are refused', () => {
  assert.throws(() => parseRawText('LevelView 7', JSON.stringify({ Foo: 1 })), /unknown dialect/);
  assert.throws(() => parseRawText('LevelView 7', '{nope'), /invalid JSON/);
  assert.throws(() => parseRawText('LevelView 7', '[]'), /not an object/);
});

test('unknown player type / colour and missing map-object keys error', () => {
  const d = v1() as { P: { PT: number; PC: number }[] };
  d.P[0]!.PC = 9;
  assert.throws(() => parseRawText('LevelView 7', JSON.stringify(d)), /unknown PC/);
  const e = v1() as { Wall: unknown[] };
  e.Wall = [{ P: { X: 0, Y: 0, Z: 0 }, R: { X: 0, Y: 0, Z: 0 }, S: true }];
  assert.throws(() => parseRawText('LevelView 7', JSON.stringify(e)), /Wall\[0\]: missing key "Hp"/);
});

test('UTF-8 BOM is tolerated', () => {
  const text = readFileSync(join(FIXTURE_TEXTASSETS, 'LevelView 1_-5730288583589927379.json'), 'utf8');
  assert.deepEqual(parseRawText('LevelView 1', `﻿${text}`), parseRawText('LevelView 1', text));
});

test('unrecognised keys are kept (extra), never silently dropped', () => {
  const d = v1() as { Zork?: number; P: { Q?: number }[] };
  d.Zork = 5;
  d.P[0]!.Q = 1;
  const lv = parseRawText('LevelView 1', JSON.stringify(d));
  assert.deepEqual(lv.extra, { Zork: 5 });
  assert.deepEqual(lv.players[0]?.extra, { Q: 1 });
});
