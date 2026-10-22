#!/usr/bin/env node
// assets:validate — SP07 R2 prototype validation gate.
//   TW_EXTRACT=/root/projects/tower-war/_extract pnpm assets:validate [--no-render] [--out dir]
// Without TW_EXTRACT (or a missing extract) it prints a skip notice and exits 0 (CI has no extract).
// For each in-scope prototype GLB it (1) runs the automated checks on the prototype as authored and on the
// in-memory RAW candidate (candidate.mjs = what the Task 3 importer must emit), both judged under the mirrored
// worldRoot (02 Frame contract); (2) runs the same checks on the real Task 3 importer output (tools/src/assets-tw, regenerated
// into gitignored BF/ref/out/importer-tw); (3) renders turntable sheets to <out>. Exit 1 only if a RAW candidate or the importer output fails.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { analyze } from './analyze.mjs';
import { toRaw } from './candidate.mjs';
import { startShooter } from './shots.mjs';
import { runImport } from '../../src/assets-tw/run.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const BF = path.join(repo, 'docs/agent_files/feat-tower-war-port-20261022-0321');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const outDir = path.resolve(opt('out', path.join(BF, 'ref/proto-check')));
const render = !args.includes('--no-render');

const EXTRACT = process.env.TW_EXTRACT;
if (!EXTRACT || !fs.existsSync(path.join(EXTRACT, 'catalog/glb_proto'))) {
  console.log('assets:validate: TW_EXTRACT not set or has no catalog/glb_proto; skipping (needs the private Tower War extract).');
  process.exit(0);
}
const cat = f => path.join(EXTRACT, 'catalog', f);
const tex2d = name => {
  const dir = path.join(EXTRACT, 'assets/defaultlocalgroup_assets/Texture2D');
  const hit = fs.readdirSync(dir).find(f => new RegExp(`^${name}_-?\\d+\\.png$`).test(f));
  return hit ? path.join(dir, hit) : null;
};
const sceneTex = name => {
  const dir = path.join(EXTRACT, 'assets/defaultlocalgroup_scenes/Texture2D');
  const hit = fs.readdirSync(dir).find(f => f.startsWith(`${name}@sh`) || f.startsWith(`${name}.`));
  return hit ? path.join(dir, hit) : null;
};
const sprite = prefix => {
  const dir = path.join(EXTRACT, 'assets/defaultlocalgroup_assets/Sprite');
  const hit = fs.readdirSync(dir).find(f => new RegExp(`^${prefix}_-?\\d+\\.png$`).test(f));
  return hit ? path.join(dir, hit) : null;
};

// In-scope assets (PRD R1) + one out-of-scope calibration asset (Cowboy: source of the "known sizes").
const ASSETS = [
  { id: 'soldier-default', imp: 'soldier', glb: cat('glb_proto/1_MilitaryDefaultWarriorSkinData.glb'), opts: { hands: true, weaponIcon: true }, icon: sprite('1_Base'), clip: 'Run' },
  { id: 'tank-default', imp: 'tank', glb: cat('glb_proto/1_MilitaryAttackWarriorSkinData.glb'), opts: { expected: [0.94, 1.0, 1.6] }, icon: sprite('1_tank') },
  { id: 'barracks-wt1', imp: 'barracks', glb: cat('glb_proto_buildings/House_Default__None_.glb'), opts: {}, texPrefix: 'MilitaryDefaultHouse', stages: [0, 1, 2] },
  { id: 'factory-wt2', imp: 'factory', glb: cat('glb_proto_buildings/House_Attack__None_.glb'), opts: {}, texPrefix: 'MilitaryAttHouse' },
  { id: 'watch-tower', imp: 'tower', glb: cat('glb_proto_buildings/Tower.glb'), opts: {}, texPrefix: 'MilitaryTower', stages: [0, 1, 2] },
  { id: 'calibration-cowboy', glb: cat('glb_proto/10_CowboyDefaultWarriorSkinDara.glb'), opts: { hands: true, expected: [0.6, 0.9, 0.85], rightPart: 'holster' }, calibration: true },
];
for (const a of ASSETS) {
  if (a.texPrefix) {
    a.neutralTex = tex2d(`${a.texPrefix}Neutral${a.texPrefix === 'MilitaryTower' ? 'Texture' : 'Texture'}`) ?? tex2d(`${a.texPrefix}NeutralTexture`);
    a.opts.texFile = a.neutralTex;
  }
  if (!fs.existsSync(a.glb)) { console.error(`missing prototype GLB: ${a.glb}`); process.exit(2); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-validate-'));
const rawDir = path.join(BF, 'ref/out/proto-check-raw'); // gitignored scratch (BF/ref/out)
fs.mkdirSync(rawDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

// Importer output (Task 3): regenerate into the temp dir; models carry no texture, so unit checks use the blue team texture, buildings the neutral one.
const impDir = path.join(BF, 'ref/out/importer-tw'); // gitignored scratch inside the repo (the render server only serves the repo + extract)
fs.rmSync(impDir, { recursive: true, force: true });
const imported = await runImport(EXTRACT);
for (const [p, bytes] of imported.files) { fs.mkdirSync(path.dirname(path.join(impDir, p)), { recursive: true }); fs.writeFileSync(path.join(impDir, p), bytes); }

const report = { rulesOfJudgement: 'as the game sees it: under the mirrored worldRoot (scale.z=-1), FrontSide', assets: {} };
let failed = false;
for (const a of ASSETS) {
  a.rawGlb = path.join(rawDir, `${a.id}.glb`);
  await toRaw(a.glb, a.rawGlb);
  const proto = await analyze(a.glb, a.opts);
  const raw = await analyze(a.rawGlb, a.opts);
  let importer = null;
  if (a.imp) {
    a.impGlb = path.join(impDir, 'models/tw', `${a.imp}.glb`);
    importer = await analyze(a.impGlb, { ...a.opts, texFile: path.join(impDir, 'textures/tw', `${a.imp}-${a.texPrefix ? 'gray' : 'blue'}.png`) });
  }
  report.assets[a.id] = { proto, rawCandidate: raw, ...(importer ? { importer } : {}), calibration: !!a.calibration };
  const fails = v => Object.entries(v.checks).filter(([, c]) => c && c.pass === false).map(([k]) => k);
  const pf = fails(proto), rf = fails(raw), imf = importer ? fails(importer) : null;
  console.log(`${a.calibration ? '(calibration) ' : ''}${a.id.padEnd(20)} proto: ${pf.length ? 'FAIL ' + pf.join(',') : 'pass'} | raw candidate: ${rf.length ? 'FAIL ' + rf.join(',') : 'pass'}${imf ? ` | importer: ${imf.length ? 'FAIL ' + imf.join(',') : 'pass'}` : ''}`);
  if ((rf.length || imf?.length) && !a.calibration) failed = true;
}
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(stripBulk(report), null, 2) + '\n');
console.log(`report: ${path.relative(repo, path.join(outDir, 'report.json'))}`);

if (render) await renderAll(ASSETS);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? 'assets:validate: RAW candidate or importer output FAILED (see above)' : 'assets:validate: RAW candidate and importer output pass all in-scope automated checks');
process.exit(failed ? 1 : 0);

function stripBulk(r) { return JSON.parse(JSON.stringify(r)); }

async function label(text, w, h = 22, bg = '#202020') {
  const t = await sharp({ text: { text: `<span foreground="white">${text}</span>`, rgba: true, font: 'sans 11', dpi: 72 } }).png().toBuffer();
  return sharp({ create: { width: w, height: h, channels: 4, background: bg } }).composite([{ input: t, left: 6, top: 3 }]).png().toBuffer();
}
/** rows: [{label, imgs:[Buffer]}] -> one PNG, each row a label bar over a strip of equal-sized tiles. */
async function sheet(file, rows, tile) {
  const cols = Math.max(...rows.map(r => r.imgs.length));
  const comps = [];
  let y = 0;
  for (const r of rows) {
    comps.push({ input: await label(r.label, cols * tile), left: 0, top: y }); y += 22;
    r.imgs.forEach((b, i) => comps.push({ input: b, left: i * tile, top: y }));
    y += tile;
  }
  await sharp({ create: { width: cols * tile, height: y, channels: 3, background: '#303030' } }).composite(comps).png().toFile(file);
  console.log(`sheet ${path.relative(repo, file)}`);
}

async function renderAll(assets) {
  const shooter = await startShooter({ extract: EXTRACT });
  const T = 256;
  const shot = async (glb, o) => (await shooter.shoot({ glb, w: T, h: T, ...o })).buf;
  try {
    for (const a of assets) {
      const tex = a.neutralTex ? `/@fs${a.neutralTex}` : undefined;
      const base = { tex };
      const yaws = [0, 90, 180, 270];
      const row = async (glb, extra) => {
        const imgs = [];
        for (const yaw of yaws) imgs.push(await shot(glb, { ...base, yaw, pitch: 20, ...extra }));
        imgs.push(await shot(glb, { ...base, yaw: 180, pitch: 55, fov: 21, ...extra })); // game camera: FOV 21 / pitch 55
        return imgs;
      };
      const rows = [
        { label: `${a.id} PROTO as authored, mirrored worldRoot: yaw 0/90/180/270 + game cam (FOV21 pitch55)`, imgs: await row(a.glb, {}) },
        { label: `${a.id} RAW candidate (importer output), mirrored worldRoot: same views`, imgs: await row(a.rawGlb, {}) },
      ];
      if (a.impGlb) {
        const impTex = `/@fs${path.join(impDir, 'textures/tw', `${a.imp}-${a.texPrefix ? 'gray' : 'blue'}.png`)}`;
        const impBase = { tex: impTex };
        const impRow = async extra => { const imgs = []; for (const yaw of yaws) imgs.push(await shot(a.impGlb, { ...impBase, yaw, pitch: 20, ...extra })); imgs.push(await shot(a.impGlb, { ...impBase, yaw: 180, pitch: 55, fov: 21, ...extra })); return imgs; };
        rows.push({ label: `${a.id} IMPORTER output (tools/src/assets-tw), mirrored worldRoot: same views`, imgs: await impRow({}) });
        if (a.clip) rows.push({ label: `${a.id} IMPORTER output, ${a.clip} frame 0 pose`, imgs: await impRow({ clip: a.clip, t: 0 }) });
        if (a.stages) for (const st of a.stages) rows.push({ label: `${a.id} IMPORTER output stage ${st} (stage${st})`, imgs: await impRow({ stage: st }) });
        if (a.id === 'factory-wt2') for (const st of [0, 1, 2]) rows.push({ label: `factory-wt2 IMPORTER output stage ${st} (extras.stageNodes[${st}])`, imgs: await impRow({ stageNodes: st }) });
      }
      if (a.clip) rows.push({ label: `${a.id} RAW candidate, ${a.clip} frame 0 pose`, imgs: await row(a.rawGlb, { clip: a.clip, t: 0 }) });
      if (a.stages) {
        for (const st of a.stages) rows.push({ label: `${a.id} RAW candidate stage ${st} (stageMesh_${st})`, imgs: await row(a.rawGlb, { stage: st }) });
      }
      if (a.id === 'factory-wt2') rows.push({ label: 'factory-wt2 RAW candidate, ALL nodes visible (incl. prefab-inactive pipes/windows)', imgs: await row(a.rawGlb, { showAll: true }) });
      await sheet(path.join(outDir, `${a.id}-turntable.png`), rows, T);
      if (a.icon) {
        // Front view vs the `1_*` icon sprite (icon pose differs: it holds the gun; model is the Run pose).
        const iconBuf = await sharp(a.icon).resize(T, T, { fit: 'contain', background: '#6f9a3a' }).flatten({ background: '#6f9a3a' }).png().toBuffer();
        const mk = async glb => { const o = []; for (const yaw of [150, 180, 210]) o.push(await shot(glb, { ...base, yaw, pitch: 10, ...(a.clip ? { clip: a.clip, t: 0 } : {}) })); return o; };
        await sheet(path.join(outDir, `${a.id}-vs-icon.png`), [
          { label: `${a.id}: icon sprite | PROTO as authored (mirrored root) yaw 150/180/210`, imgs: [iconBuf, ...(await mk(a.glb))] },
          { label: `${a.id}: icon sprite | RAW candidate (mirrored root) yaw 150/180/210`, imgs: [iconBuf, ...(await mk(a.rawGlb))] },
        ], T);
      }
    }
    await refCompare(shooter);
  } finally {
    await shooter.close();
  }
}

/** Scene-rig renders (game's own light/ambient) next to cropped tw-yt reference frames; colour-space A/B. */
async function refCompare(shooter) {
  const T = 300;
  const tw = path.join(BF, 'ref/tw-yt');
  const crop = async (file, { left, top, width, height }) => sharp(path.join(tw, file)).extract({ left, top, width, height }).resize({ height: T }).png().toBuffer();
  const ground = `/@fs${tex2d('MilitaryGroundTexture')}`;
  const base = { rig: 'tw', ground, yaw: 0, pitch: 55, fov: 21, w: T, h: T };
  const shot = async (glb, o) => (await shooter.shoot({ glb, ...base, ...o })).buf;
  const seq = async (items, fn) => { const out = []; for (const it of items) out.push(await fn(it)); return out; }; // one page: never concurrent
  const raw = id => path.join(rawDir, `${id}.glb`);
  const red = `/@fs${tex2d('MilitaryDefaultHouseRedTexture')}`, blue = `/@fs${tex2d('MilitaryDefaultHouseBlueTexture')}`;
  const rows = [];
  rows.push({ label: 'barracks: ref d-house-levels-11 (red 5, blue 5 crop) | linear workflow (SRGB tex + sRGB out): red s0, blue s0 | gamma (raw tex, no encode): red s0, blue s0', imgs: [
    await crop('d-house-levels-11.jpg', { left: 0, top: 290, width: 300, height: 130 }),
    ...(await seq([['srgb', red], ['srgb', blue], ['gamma', red], ['gamma', blue]], ([color, tex]) => shot(raw('barracks-wt1'), { color, tex, stage: 0 }))),
  ] });
  rows.push({ label: 'barracks stage 1 / stage 2 (blue), game rig, linear workflow vs ref d-tank-house (blue 21 house crop)', imgs: [
    await crop('d-tank-house.jpg', { left: 105, top: 270, width: 90, height: 123 }),
    ...(await seq([1, 2], stage => shot(raw('barracks-wt1'), { color: 'srgb', tex: blue, stage }))),
  ] });
  rows.push({ label: 'neutral factory: ref d-house-levels-11 (gray factory crop) | render, linear workflow | render, gamma', imgs: [
    await crop('d-house-levels-11.jpg', { left: 335, top: 60, width: 99, height: 100 }),
    ...(await seq(['srgb', 'gamma'], color => shot(raw('factory-wt2'), { color, tex: `/@fs${tex2d('MilitaryAttHouseNeutralTexture')}` }))),
  ] });
  rows.push({ label: 'neutral tower: ref d-tower-firing (pagoda crop) | render, linear workflow | render, gamma', imgs: [
    await crop('d-tower-firing.jpg', { left: 235, top: 65, width: 90, height: 100 }),
    ...(await seq(['srgb', 'gamma'], color => shot(raw('watch-tower'), { color, tex: `/@fs${tex2d('MilitaryTowerNeutralTexture')}` }))),
  ] });
  // each ref crop keeps its aspect; pad every tile to T x T so sheet() can tile them
  for (const r of rows) r.imgs[0] = await sharp(r.imgs[0]).resize(T, T, { fit: 'contain', background: '#303030' }).png().toBuffer();
  await sheet(path.join(outDir, 'colorspace-and-ref-compare.png'), rows, T);
}
