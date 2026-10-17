/// <reference types="vite/client" />
import { compileLevel, loadContent } from '../../../src/index.js';

// Exercise the real authored files and the same package core that the web client uses.
const raw = import.meta.glob<string>(['../../../content.json', '../../../data/**/*.json'], {
  eager: true, query: '?raw', import: 'default',
});
const files = Object.fromEntries(Object.entries(raw).map(([path, text]) => [path.replace(/^\.\.\/\.\.\/\.\.\//, ''), text]));
const loaded = loadContent(files);
const levels = Object.values(loaded).filter(entity => 'towers' in entity).map(entity => compileLevel(loaded, entity.id));
const globals = globalThis as typeof globalThis & { process?: unknown; Buffer?: unknown; global?: unknown };
document.querySelector('#result')!.textContent = JSON.stringify({
  paths: Object.keys(files).sort(), levels,
  nodeGlobals: [typeof globals.process, typeof globals.Buffer, typeof globals.global],
});
