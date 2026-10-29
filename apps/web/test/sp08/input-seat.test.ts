import { expect, it } from 'vitest';
import { Group, PerspectiveCamera, Vector3 } from 'three';
import type { Sim } from '@node-arena/sim';
import { createInputController } from '../../src/input/index.js';

class Canvas extends EventTarget {
  style = { touchAction: '', cursor: '' }; ownerDocument = { defaultView: new EventTarget() };
  getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 1000 }; }
  setPointerCapture() {} hasPointerCapture() { return false; } releasePointerCapture() {}
}
function event(canvas: Canvas, type: string, x: number, y: number) { const e = new Event(type, { cancelable: true }); Object.assign(e, { clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }); canvas.dispatchEvent(e); }

function setup(seat?: number | null, kinds: string[] = ['human']) {
  const canvas = new Canvas(), camera = new PerspectiveCamera(45, 1, .1, 100); camera.position.set(0, 10, 12); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const root = new Group(); root.scale.z = -1; root.updateMatrixWorld();
  const points = [new Vector3(-2, 0, 1), new Vector3(2, 0, 1)]; const commands: unknown[] = [];
  const owner = kinds.map((_, i) => i);
  const sim = { view: { players: kinds.map(kind => ({ kind, colorKey: 'blue' })), ids: { buildings: ['a', 'b'] }, buildings: { owner: [owner[seat ?? 0] ?? 0, -1] }, buildingStatic: [{ drawsLines: true }, { drawsLines: true }], lines: [], over: null }, canDraw: () => null, explainDraw: () => ({ reason: null }) } as unknown as Sim;
  const world = { anchors: { building: (id: string) => ({ pos: points[id === 'a' ? 0 : 1]!, radius: .7, labelPos: new Vector3() }) }, pickMeshes: [], previewLane: () => {}, clearPreview: () => {}, select: () => {} };
  createInputController({ canvas: canvas as unknown as HTMLCanvasElement, camera, worldRoot: root, sim, world, driver: { submit: c => commands.push(c) }, ...(seat === undefined ? {} : { seat }) });
  const screen = (i: number) => { const p = points[i]!.clone().applyMatrix4(root.matrixWorld).project(camera); return [(p.x + 1) * 500, (1 - p.y) * 500] as const; };
  const [ax, ay] = screen(0), [bx, by] = screen(1);
  const drag = () => { event(canvas, 'pointerdown', ax, ay); event(canvas, 'pointermove', bx, by); event(canvas, 'pointerup', bx, by); };
  return { commands, drag };
}

it('default seat is the first human (campaign unchanged)', () => {
  const t = setup(undefined, ['bot', 'human']);
  // building owner[0] is player 0 (bot) via owner map default -> not own; use explicit owner below
  t.drag(); expect(t.commands).toEqual([]);
  const u = setup(undefined, ['human']); u.drag();
  expect(u.commands).toEqual([{ type: 'DrawLine', player: 0, from: 0, to: 1 }]);
});
it('explicit seat is used as command player', () => {
  const t = setup(1, ['bot', 'bot']); t.drag();
  expect(t.commands).toEqual([{ type: 'DrawLine', player: 1, from: 0, to: 1 }]);
});
it('null seat is read-only: drawing blocked', () => {
  const t = setup(null, ['human']); t.drag();
  expect(t.commands).toEqual([]);
});
