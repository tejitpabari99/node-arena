#!/usr/bin/env node
// SP08-owned UI import. node --import tsx tools/assets/ui-sprites.mjs [--check]
// Import needs TW_EXTRACT; --check always verifies committed outputs, and source hashes when available.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main as mergeMain } from '../src/assets-tw/merge-cli.ts';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const assets = resolve(option('--assets', join(root, 'apps/web/assets')));
const lockPath = resolve(option('--lock', join(root, 'tools/assets/ui-sprites.lock.json')));
const extract = process.env.TW_EXTRACT;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const sourceDir = 'assets/defaultlocalgroup_assets/Sprite';
const selection = {
  back: ['icon_replay_3634523782040163252.png'],
  backButton: ['back_button_8931190119670670509.png'],
  barBack: ['bar_back_2061739084309080640.png'],
  popup: ['bg_popup_1_-5735763378444923586.png'],
  primary: ['LoseVictoryButton_-7321245380983350766.png'],
  secondary: ['Button_Gray_-7921802730567541994.png'],
  soundOn: ['sound_on_icon_1205780184134245712.png'],
  soundOff: ['sound_off_icon_7389953912037365447.png'],
};
const walk = (dir, prefix = '') => !existsSync(dir) ? [] : readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]);
try {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') continue;
    if (['--assets', '--lock'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) { i++; continue; }
    throw new Error(`Unknown or incomplete option: ${args[i]}`);
  }
  if (args.includes('--check')) {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')), errors = [];
    for (const [file, hash] of Object.entries(lock.outputs)) {
      if (!existsSync(join(assets, file)) || sha(readFileSync(join(assets, file))) !== hash) errors.push(`${file}: missing or hash differs`);
    }
    for (const file of walk(join(assets, 'ui'))) if (!Object.hasOwn(lock.outputs, `ui/${file}`)) errors.push(`ui/${file}: stale output`);
    if (extract && existsSync(extract)) for (const [file, hash] of Object.entries(lock.inputs)) {
      if (!existsSync(join(extract, file)) || sha(readFileSync(join(extract, file))) !== hash) errors.push(`${file}: source missing or hash differs`);
    }
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`UI assets OK (${Object.keys(lock.outputs).length} locked outputs; ${extract ? 'source hashes checked' : 'committed-only, TW_EXTRACT unset'})`);
  } else {
    if (!extract || !existsSync(extract)) throw new Error('TW_EXTRACT must point to the private Tower War extract to import UI sprites');
    const inputs = {}, outputs = {}, sprites = {};
    mkdirSync(join(assets, 'ui'), { recursive: true });
    const emit = (file, bytes) => { mkdirSync(dirname(join(assets, file)), { recursive: true }); writeFileSync(join(assets, file), bytes); outputs[file] = sha(bytes); };
    for (const [id, [source]] of Object.entries(selection)) {
      const sourcePath = `${sourceDir}/${source}`, bytes = readFileSync(join(extract, sourcePath));
      if (bytes.readUInt32BE(0) !== 0x89504e47) throw new Error(`${source}: expected PNG`);
      const path = `ui/${id}.png`;
      inputs[sourcePath] = sha(bytes);
      emit(path, bytes);
      sprites[id] = { path, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    const fragment = {
      format: 1, sprites,
      font: { family: 'Coiny', path: 'fonts/Coiny-Regular.ttf', license: 'licenses/coiny-OFL.txt', fallback: 'system-ui, sans-serif' },
      layout: {
        reference: { width: 1600, height: 900 }, scale: { min: 0.75, max: 1.2, basis: 'min(width/1600,height/900)' },
        back: { left: 28, top: 24, width: 58, height: 58, sprite: 'back' },
        ownership: { top: 24, width: 480, height: 42, border: 4, radius: 21, sprite: 'barBack' },
        level: { top: 74, fontSize: 24 }, mute: { right: 28, top: 24, width: 48, height: 48 },
        popup: { width: 520, padding: 32, sprite: 'popup', radius: 24 },
        action: { width: 360, height: 70, gap: 14, primarySprite: 'primary', secondarySprite: 'secondary' },
        safeArea: { top: 112, bottom: 24, left: 24, right: 24 },
      },
    };
    emit('manifest.ui.json', json(fragment));
    for (const file of [fragment.font.path, fragment.font.license]) outputs[file] = sha(readFileSync(join(assets, file)));
    if (mergeMain([], assets) !== 0) throw new Error('manifest merge failed');
    outputs['ui/manifest.json'] = sha(readFileSync(join(assets, 'ui/manifest.json')));
    for (const file of walk(join(assets, 'ui'))) if (!Object.hasOwn(outputs, `ui/${file}`)) rmSync(join(assets, 'ui', file));
    writeFileSync(lockPath, json({ format: 1, inputs, outputs }));
    console.log(`UI assets imported (${Object.keys(selection).length} sprites; Coiny reused)`);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
