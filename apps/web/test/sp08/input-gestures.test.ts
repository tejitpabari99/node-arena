import { describe, expect, it } from 'vitest';
import { segmentDistance } from '../../src/input/geometry.js';
import { createGestureMachine } from '../../src/input/gestures.js';

function setup() {
  let time = 0; const commands: unknown[] = [], strokes: unknown[] = [];
  const machine = createGestureMachine({ now: () => time, diagonal: () => 1000,
    own: i => i === 0, canDraw: (_a, b) => b === 1,
    draw: (a,b) => commands.push([a,b]), stroke: (a,b,seen) => { if (!seen.has(3)) { seen.add(3); strokes.push([a.x,b.x]); } },
    preview: () => {}, clear: () => {}, eraser: () => {}, trail: () => {},
  });
  return { machine, commands, strokes, clock: (t: number) => { time=t; machine.refresh(); } };
}
const p = (x: number, building: number | null = null) => ({x,y:0,building});
describe('gesture machine', () => {
  it('requires diagonal threshold then commits valid mouse draw immediately', () => {
    const h=setup(); h.machine.down(1,'mouse',0,p(0,0)); h.machine.up(1,p(5,1)); expect(h.commands).toEqual([]);
    h.machine.down(1,'mouse',0,p(0,0)); h.machine.move(1,p(20,1)); h.machine.up(1,p(20,1)); expect(h.commands).toEqual([[0,1]]);
  });
  it('delays non-mouse draw 200ms and suppresses blocked/free-ground release', () => {
    const h=setup(); h.machine.down(1,'touch',0,p(0,0)); h.machine.move(1,p(20,1)); h.machine.up(1,p(20,1)); expect(h.commands).toEqual([]);
    h.machine.down(1,'touch',0,p(0,0)); h.machine.move(1,p(20,1)); h.clock(200); h.machine.up(1,p(20,1)); expect(h.commands).toEqual([[0,1]]);
    for (const target of [null,2]) { h.machine.down(1,'mouse',0,p(0,0)); h.machine.up(1,p(20,target)); }
    expect(h.commands).toHaveLength(1);
  });
  it('cuts empty-ground and right-button strokes once per channel', () => {
    const h=setup(); h.machine.down(1,'mouse',0,p(0)); h.machine.move(1,p(20)); h.machine.move(1,p(40)); h.machine.up(1,p(50)); expect(h.strokes).toHaveLength(1);
    h.machine.down(1,'mouse',2,p(0,0)); h.machine.move(1,p(20,1)); h.machine.up(1,p(20,1)); expect(h.strokes).toHaveLength(2); expect(h.commands).toEqual([]);
  });
  it('enters eraser at 700ms only while holding still on ground', () => {
    const h=setup(); h.machine.down(1,'mouse',0,p(0)); h.clock(699); expect(h.machine.mode).toBe('pending-cut'); h.clock(700); expect(h.machine.mode).toBe('eraser'); h.machine.move(1,p(20)); expect(h.strokes).toHaveLength(1); h.machine.up(1,p(20)); expect(h.machine.mode).toBe('idle');
    h.machine.down(1,'mouse',0,p(0)); h.machine.move(1,p(20)); h.clock(1500); expect(h.machine.mode).toBe('cut');
  });
  it('cancels every gesture and ignores secondary pointers and enemy sources', () => {
    const h=setup(); h.machine.down(1,'mouse',0,p(0,0)); h.machine.move(2,p(20,1)); h.machine.up(2,p(20,1)); expect(h.machine.mode).toBe('pending-draw'); h.machine.cancel(); h.machine.up(1,p(20,1)); expect(h.commands).toEqual([]);
    h.machine.down(1,'mouse',0,p(0,1)); expect(h.machine.mode).toBe('idle');
    for (const button of [0,2]) { h.machine.down(1,'mouse',button,p(0)); h.machine.cancel(); expect(h.machine.mode).toBe('idle'); }
  });
});

for (const button of [0, 2]) for (const steps of [1, 20]) {
  it(`cuts an early crossing with button ${button} in ${steps} move events`, () => {
    const cuts: number[] = [];
    const machine = createGestureMachine({
      now: () => 0, diagonal: () => Math.hypot(1600, 900),
      own: () => true, canDraw: () => true, draw: () => {},
      stroke: (a, b, seen) => {
        if (!seen.has(3) && segmentDistance(a, b, { x: 5, y: -100 }, { x: 5, y: 100 }) <= 8) {
          seen.add(3); cuts.push(3);
        }
      },
      preview: () => {}, clear: () => {}, eraser: () => {}, trail: () => {},
    });
    machine.down(1, 'mouse', button, p(0));
    for (let step = 1; step <= steps; step++) machine.move(1, p(step * 40 / steps));
    machine.up(1, p(40));
    expect(cuts).toEqual([3]);
  });
}
