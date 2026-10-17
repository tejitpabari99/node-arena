import { runCorpus } from '../matches.mjs';
window.runBotCorpus = levels => ({ matches: runCorpus(levels), nodeGlobals: [typeof globalThis.process, typeof globalThis.Buffer, typeof globalThis.global] });
