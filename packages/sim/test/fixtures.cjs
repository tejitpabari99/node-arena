// Shared fixtures: the promoted content (levelview-1) compiled with the real loader/compiler.
const fs = require('node:fs');
const path = require('node:path');
require('tsx/cjs');
const content = require('../../content/src/index.ts');

const root = path.resolve(__dirname, '../../content');
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'content.json'), 'utf8'));

function dataFiles() {
  const files = { 'data/balance.json': fs.readFileSync(path.join(root, 'data/balance.json'), 'utf8') };
  for (const dir of ['units', 'buildings', 'elements', 'campaigns', 'levels']) {
    for (const name of fs.readdirSync(path.join(root, 'data', dir)).sort()) files[`data/${dir}/${name}`] = fs.readFileSync(path.join(root, 'data', dir, name), 'utf8');
  }
  return files;
}
/** Fresh compiled `levelview-1` (callers may mutate the returned object). */
function compiledGolden() { return content.loadContent(dataFiles()).compiled['levelview-1']; }
module.exports = { metadata, dataFiles, compiledGolden, content };
