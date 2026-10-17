// Nonempty shared fixture for cross-runtime identity verification.
import { generateHashes, loadContent } from '../src/index.js';
import { hashFixture } from './hash-fixture.js';
console.log(JSON.stringify(generateHashes(loadContent(hashFixture()))));
