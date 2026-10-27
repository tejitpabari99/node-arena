import { describe, expect, it } from 'vitest';
import { CHECK_LEGEND, formatGameTime, formatIssue, formatRunLine, outcomeText, runKindLabel, runTable, summaryLine, uniqueRuns, winnerLabel, type CheckRun } from '../../src/editor/check-format.js';
import type { EditorProxyEvent } from '../../../../tools/src/editor-solvable.js';

const run = (proxy: string, seed: number, over: Partial<CheckRun> = {}): CheckRun => ({ proxy, seed, outcome: 'won', winner: 0, won: true, truncated: false, ticks: 1700, finalHash: 'h', rejected: 0, ...over });
const progress = (r: CheckRun): EditorProxyEvent => ({ type: 'progress', run: r });

describe('check run formatting', () => {
  it('converts ticks at 20/s to m:ss', () => {
    expect(formatGameTime(1700)).toBe('1:25'); expect(formatGameTime(1973)).toBe('1:39'); expect(formatGameTime(0)).toBe('0:00');
  });
  it('names run kinds', () => {
    expect(runKindLabel('idle')).toBe('Do-nothing baseline');
    expect(runKindLabel('proxy-500')).toBe('Auto-player (fast, every 0.5 s)');
    expect(runKindLabel('proxy-1000')).toBe('Auto-player (medium, every 1 s)');
    expect(runKindLabel('proxy-2000')).toBe('Auto-player (slow, every 2 s)');
  });
  it('labels winners and outcomes', () => {
    expect(winnerLabel(null, 0)).toBe('nobody'); expect(winnerLabel(0, 0)).toBe('You'); expect(winnerLabel(2, 0)).toBe('Player 3');
    expect(outcomeText(run('idle', 1, { outcome: 'lost', winner: null, won: false }))).toBe('Lost');
    expect(outcomeText(run('idle', 1, { outcome: 'timeout', winner: null, won: false }))).toBe('Lost (time ran out)');
    expect(outcomeText(run('idle', 1, { outcome: 'truncated', winner: null, won: false, truncated: true }))).toContain('safety cap');
  });
  it('formats a line', () => {
    expect(formatRunLine(run('proxy-500', 1), 0)).toBe('Auto-player (fast, every 0.5 s) · start 1 · Won in 1:25');
    expect(formatRunLine(run('idle', 1, { outcome: 'timeout', winner: null, won: false, ticks: 1973 }), 0)).toBe('Do-nothing baseline · start 1 · Lost (time ran out) in 1:39');
  });
  it('drops the determinism rerun duplicate and builds a table', () => {
    const events = [progress(run('idle', 1)), progress(run('proxy-2000', 1)), progress(run('proxy-500', 1)), progress(run('proxy-500', 2)), progress(run('proxy-2000', 1))];
    const runs = uniqueRuns(events); expect(runs).toHaveLength(4);
    const table = runTable(runs);
    expect(table.seeds).toEqual([1, 2]); expect(table.rows.map(r => r.proxy)).toEqual(['idle', 'proxy-500', 'proxy-2000']);
    expect(table.rows[1]!.cells.get(2)).toBe(runs[3]);
  });
  it('summarises and explains', () => {
    expect(summaryLine({ totalWins: 12, runs: 12, ok: true })).toBe('Auto-player won 12 of 12 test games. Level data is valid.');
    expect(summaryLine({ totalWins: 0, runs: 12, ok: false })).toContain('failed');
    expect(CHECK_LEGEND.hint).toContain('not proof');
  });
});

describe('issue formatting', () => {
  const issue = (pointer: string, message: string) => ({ file: 'level.json', pointer, message });
  it('says to add a building', () => {
    const f = formatIssue(issue('/buildings', 'must NOT have fewer than 1 items'), '/buildings');
    expect(f.text).toBe('Add at least one building'); expect(f.raw).toBe('/buildings: must NOT have fewer than 1 items');
    expect(formatIssue(issue('/buildings', 'Add at least one building')).text).toBe('Add at least one building');
  });
  it('rewrites common Ajv messages with a readable path', () => {
    expect(formatIssue(issue('/players', 'must NOT have fewer than 2 items'), '/players').text).toBe('players: needs at least 2 items');
    expect(formatIssue(issue('/buildings/0/level', 'must be >= 1'), 'buildings b1 (/buildings/0/level)').text).toBe('buildings b1 (/buildings/0/level): must be at least 1');
    expect(formatIssue(issue('/name', "must have required property 'name'")).text).toBe('name: name is required');
  });
  it('passes non-schema messages through', () => {
    expect(formatIssue(issue('/players', 'Player required'), '/players').text).toBe('/players: Player required');
  });
});
