import { Vector3, type Camera } from 'three';
import { Disposables } from './disposables.js';
import type { OverlayValue } from './overlays.js';

export const LABEL_FOREGROUND = "#ffffff";
export const LABEL_BACKGROUND = "#111827";

export function clampLabelPosition(x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  return { x: Math.max(0, Math.min(x - width / 2, viewportWidth - width)), y: Math.max(0, Math.min(y - height, viewportHeight - height)) };
}
function text(element: HTMLElement, value: string) { if (element.textContent !== value) element.textContent = value; }
function attribute(element: HTMLElement, name: string, value: string) { if (element.getAttribute(name) !== value) element.setAttribute(name, value); }

export interface TowerLabel {
  readonly element: HTMLDivElement;
  readonly position: Vector3;
  update(marker: string, color: string, values: readonly (OverlayValue & { key: string })[]): void;
}
/** Crisp, fixed-width chips reserve their box so value updates never trigger projection. */
export function createLabelLayer(parent: HTMLElement, scope: Disposables) {
  const layer = scope.label(document.createElement('div'));
  layer.dataset.towerLabels = ''; layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
  const previousPosition = parent.style.position;
  if (getComputedStyle(parent).position === 'static') { parent.style.position = 'relative'; scope.defer(() => { parent.style.position = previousPosition; }); }
  parent.appendChild(layer);
  const labels: { label: TowerLabel; rows: Map<string, HTMLSpanElement>; height: number }[] = [];
  const add = (index: number, position: Vector3, keys: readonly string[]): TowerLabel => {
    const element = scope.label(document.createElement('div'));
    element.dataset.towerIndex = String(index);
    element.style.cssText = `position:absolute;box-sizing:border-box;width:96px;max-width:100%;padding:3px 5px;color:${LABEL_FOREGROUND};background:${LABEL_BACKGROUND};border:2px solid;outline:1px solid #000;border-radius:5px;font:600 14px/18px sans-serif;text-align:center;overflow:hidden`;
    const marker = scope.label(document.createElement('span')); marker.dataset.teamMarker = ''; marker.style.display = 'block'; element.appendChild(marker);
    const rows = new Map<string, HTMLSpanElement>();
    for (const key of keys) {
      const row = scope.label(document.createElement('span')); row.dataset.component = key;
      row.style.cssText = 'display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'; rows.set(key, row); element.appendChild(row);
    }
    layer.appendChild(element);
    const label: TowerLabel = { element, position, update(glyph, color, values) {
      text(marker, glyph);
      if (element.dataset.teamColor !== color) { element.dataset.teamColor = color; element.style.borderColor = color; }
      const byKey = new Map(values.map(value => [value.key, value]));
      for (const [key, row] of rows) { const value = byKey.get(key); text(row, value?.text ?? ''); attribute(row, 'aria-label', value?.description ?? ''); }
      attribute(element, 'aria-label', [glyph, ...values.map(value => value.description)].join(', '));
    } };
    labels.push({ label, rows, height: 8 + 18 * (keys.length + 1) }); return label;
  };
  const projected = new Vector3();
  const project = (camera: Camera, width = parent.clientWidth, height = parent.clientHeight) => {
    camera.updateMatrixWorld();
    for (const { label, height: chipHeight } of labels) {
      projected.copy(label.position).project(camera);
      const visible = projected.z >= -1 && projected.z <= 1 && Number.isFinite(projected.x) && Number.isFinite(projected.y);
      const display = visible ? '' : 'none'; if (label.element.style.display !== display) label.element.style.display = display;
      const chipWidth = Math.min(96, width), actualHeight = Math.min(chipHeight, height);
      if (label.element.style.maxHeight !== `${height}px`) label.element.style.maxHeight = `${height}px`;
      const p = clampLabelPosition((projected.x + 1) * width / 2, (1 - projected.y) * height / 2, chipWidth, actualHeight, width, height);
      const transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
      if (label.element.style.transform !== transform) label.element.style.transform = transform;
    }
  };
  return { element: layer, add, project };
}
