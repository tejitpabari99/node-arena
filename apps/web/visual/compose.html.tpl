<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{{title}}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #1b1d22; color: #e8e8e8; font: 15px/1.3 "DejaVu Sans", "Liberation Sans", Arial, sans-serif; }
  #sheet { display: inline-block; padding: 16px; }
  header { font-size: 22px; font-weight: bold; margin-bottom: 4px; }
  .meta { font-size: 14px; color: #b8bcc6; margin-bottom: 12px; font-family: "DejaVu Sans Mono", monospace; }
  .row { display: flex; gap: 20px; align-items: flex-start; }
  .col { display: flex; flex-direction: column; gap: 10px; }
  .col > h2 { margin: 0; font-size: 18px; color: #ffd166; letter-spacing: 0.04em; text-transform: uppercase; }
  .frames { display: flex; gap: 8px; align-items: flex-start; }
  .refs { display: flex; gap: 8px; align-items: flex-start; }
  .crops { display: grid; grid-template-columns: repeat(2, auto); gap: 8px; }
  figure { margin: 0; background: #2a2d34; padding: 4px; border-radius: 3px; }
  figure canvas { display: block; }
  figcaption { font-size: 14px; padding: 4px 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  figcaption b { color: #fff; }
  figcaption .sub { color: #aab; font-family: "DejaVu Sans Mono", monospace; font-size: 12px; }
  .viewport-label { font-size: 15px; font-weight: bold; color: #9ad1ff; }
  .crops figcaption { white-space: normal; }
  .crop { background: #000; }
  .na { display: flex; align-items: center; justify-content: center; text-align: center; color: #888; background: #111; font-size: 14px; padding: 8px; white-space: normal; }
  .role-chevrons { outline: 3px solid #c77dff; }
</style>
</head>
<body>
<div id="sheet">
{{body}}
</div>
<script>
// Deterministic resampling: each canvas.px gets its data-src decoded at 1:1 (drawImage without scaling) and
// area-averaged (exact box filter, JS arithmetic) from data-crop (default: whole image) to the canvas size.
window.__composeReady = (async () => {
  const cache = new Map();
  const pixels = src => {
    if (!cache.has(src)) cache.set(src, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
        resolve(g.getImageData(0, 0, c.width, c.height));
      };
      img.onerror = () => reject(new Error(`failed to load ${src}`));
      img.src = src;
    }));
    return cache.get(src);
  };
  // Per output index: list of [source index, weight] covering [o*scale, (o+1)*scale) of the source span.
  const weights = (start, span, out) => {
    const k = span / out, list = [];
    for (let o = 0; o < out; o++) {
      const a = start + o * k, b = a + k, w = [];
      for (let s = Math.floor(a); s < Math.ceil(b); s++) { const cover = Math.min(b, s + 1) - Math.max(a, s); if (cover > 0) w.push([s, cover / k]); }
      list.push(w);
    }
    return list;
  };
  for (const el of document.querySelectorAll('canvas.px')) {
    const src = await pixels(el.dataset.src), W = el.width, H = el.height;
    const [cx, cy, cw, ch] = el.dataset.crop ? el.dataset.crop.split(',').map(Number) : [0, 0, src.width, src.height];
    const wx = weights(cx, cw, W), wy = weights(cy, ch, H), row = new Float64Array(W * 4 * src.height), d = src.data;
    for (let y = Math.floor(cy); y < Math.min(src.height, Math.ceil(cy + ch)); y++) for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (const [s, w] of wx[x]) { const i = (y * src.width + s) * 4; r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; }
      const o = (y * W + x) * 4; row[o] = r; row[o + 1] = g; row[o + 2] = b;
    }
    const out = new ImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (const [s, w] of wy[y]) { const i = (s * W + x) * 4; r += row[i] * w; g += row[i + 1] * w; b += row[i + 2] * w; }
      const o = (y * W + x) * 4; out.data[o] = Math.round(r); out.data[o + 1] = Math.round(g); out.data[o + 2] = Math.round(b); out.data[o + 3] = 255;
    }
    el.getContext('2d').putImageData(out, 0, 0);
  }
  return document.querySelectorAll('canvas.px').length;
})();
</script>
</body>
</html>
