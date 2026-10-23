import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import campaign from '../../../packages/content/data/campaigns/common.json' with { type: 'json' };
import { expect, test } from '@playwright/test';
import { verifyLevel } from './verify';

const output = fileURLToPath(new URL('../../../test-results/campaign/', import.meta.url));
const entries = [...campaign.entries].sort((a, b) => a.position - b.position);

test('negative fixture rejects console errors emitted during navigation', async ({ page }) => {
  await page.addInitScript(() => console.error('campaign injected console error'));
  await expect(verifyLevel(page, 'levelview-1')).rejects.toThrow('campaign injected console error');
});

test('negative fixture rejects uncaught page errors during the run', async ({ page }) => {
  // Schedule after navigation, while the real simulation is stepping/rendering.
  await page.addInitScript(() => setTimeout(() => { throw new Error('campaign injected page error'); }, 2500));
  await expect(verifyLevel(page, 'levelview-1')).rejects.toThrow('campaign injected page error');
});

test.describe('twenty-level browser campaign', () => {
  const results: { levelId: string; tick: number; triangles: number; image: string; filename: string }[] = [];

  test.beforeAll(async () => {
    await mkdir(output, { recursive: true });
    await rm(join(output, 'grid.png'), { force: true });
    await rm(join(output, 'results.json'), { force: true });
    await rm(join(output, 'screenshots'), { recursive: true, force: true });
    await mkdir(join(output, 'screenshots'));
    expect(entries).toHaveLength(20);
    expect(new Set(entries.map(entry => entry.level)).size).toBe(20);
  });

  for (const [index, entry] of entries.entries()) {
    test(`${String(index + 1).padStart(2, '0')} ${entry.level}: five seconds of simulation and rendered browser time`, async ({ page }) => {
      const result = await verifyLevel(page, entry.level);
      const filename = `screenshots/${String(index + 1).padStart(2, '0')}-${entry.level}.png`;
      await writeFile(join(output, filename), result.screenshot);
      results.push({ levelId: result.levelId, tick: result.tick, triangles: result.triangles, filename, image: result.screenshot.toString('base64') });
    });
  }

  test.afterAll(async ({ browser }) => {
    if (results.length !== 20) return;
    const page = await browser.newPage();
    try {
      // Compose the captured browser PNGs, including their HUDs, without extra dependencies.
      const dataUrl = await page.evaluate(async captures => {
        const width = 384, height = 216, label = 28;
        const canvas = document.createElement('canvas');
        canvas.width = width * 5; canvas.height = (height + label) * 4;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#16202a'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.font = '14px sans-serif'; context.fillStyle = 'white';
        for (const [index, capture] of captures.entries()) {
          const image = new Image(); image.src = `data:image/png;base64,${capture.image}`;
          await image.decode();
          const x = (index % 5) * width, y = Math.floor(index / 5) * (height + label);
          context.drawImage(image, x, y, width, height);
          context.fillText(`${index + 1}. ${capture.levelId} · tick ${capture.tick}`, x + 8, y + height + 19);
        }
        return canvas.toDataURL('image/png');
      }, results);
      await writeFile(join(output, 'grid.png'), Buffer.from(dataUrl.split(',')[1]!, 'base64'));
      await writeFile(join(output, 'results.json'), JSON.stringify(results.map(({ image: _image, ...result }) => result), null, 2) + '\n');
    } finally { await page.close(); }
  });
});
