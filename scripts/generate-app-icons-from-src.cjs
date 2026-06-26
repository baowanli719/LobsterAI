/**
 * Generate the Windows desktop + runtime-window icons from a source PNG.
 *
 *   node scripts/generate-app-icons-from-src.cjs [source.png]
 *
 * Source defaults to ../app-icon-src.png. The source is expected to be a square
 * icon artwork on a solid (usually white) background. This script:
 *   1. removes the background via a border-connected flood fill (so it cannot
 *      punch holes in light-coloured interior details), making it transparent;
 *   2. crops to the artwork's bounding box and squares it;
 *   3. writes multi-size .ico files used by electron-builder and the runtime.
 *
 * Outputs:
 *   build/icons/win/icon.ico      desktop / taskbar / installer  (256..16)
 *   resources/tray/tray-icon.ico  runtime window + tray (Windows) (48,32,16)
 *   resources/tray/tray-icon.png  runtime window + tray (Linux)   (256)
 *
 * Uses @napi-rs/canvas (a project dependency) — no ImageMagick required.
 */
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const root = path.resolve(__dirname, '..');
const SRC = path.resolve(root, process.argv[2] || 'app-icon-src.png');

// Background pixels brighter than this on every channel are treated as removable.
const WHITE_THRESHOLD = 235;

function packIco(pngs) {
  const header = 6, entry = 16;
  let offset = header + entry * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = { w: size >= 256 ? 0 : size, h: size >= 256 ? 0 : size, len: data.length, offset, data };
    offset += data.length;
    return e;
  });
  const ico = Buffer.alloc(offset);
  ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(pngs.length, 4);
  entries.forEach((e, i) => {
    const off = header + i * entry;
    ico.writeUInt8(e.w, off); ico.writeUInt8(e.h, off + 1);
    ico.writeUInt8(0, off + 2); ico.writeUInt8(0, off + 3);
    ico.writeUInt16LE(1, off + 4); ico.writeUInt16LE(32, off + 6);
    ico.writeUInt32LE(e.len, off + 8); ico.writeUInt32LE(e.offset, off + 12);
  });
  entries.forEach(e => e.data.copy(ico, e.offset));
  return ico;
}

async function main() {
  if (!fs.existsSync(SRC)) throw new Error(`Source image not found: ${SRC}`);
  const img = await loadImage(SRC);
  const W = img.width, H = img.height;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, W, H);
  const d = id.data;

  const nearWhite = (i) =>
    d[i] > WHITE_THRESHOLD && d[i + 1] > WHITE_THRESHOLD && d[i + 2] > WHITE_THRESHOLD;

  // Border-connected flood fill: only background white becomes transparent.
  const seen = new Uint8Array(W * H);
  const stack = [];
  const pushIf = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = y * W + x;
    if (seen[p]) return;
    seen[p] = 1;
    if (nearWhite(p * 4)) stack.push(p);
  };
  for (let x = 0; x < W; x++) { pushIf(x, 0); pushIf(x, H - 1); }
  for (let y = 0; y < H; y++) { pushIf(0, y); pushIf(W - 1, y); }
  while (stack.length) {
    const p = stack.pop();
    d[p * 4 + 3] = 0;
    const x = p % W, y = (p / W) | 0;
    pushIf(x + 1, y); pushIf(x - 1, y); pushIf(x, y + 1); pushIf(x, y - 1);
  }
  ctx.putImageData(id, 0, 0);

  // Bounding box of the remaining (opaque) artwork, squared to avoid distortion.
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] !== 0) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('Source image is entirely background; nothing to crop.');
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const side = Math.max(cw, ch);
  const sq = createCanvas(side, side);
  sq.getContext('2d').drawImage(c, minX, minY, cw, ch, ((side - cw) / 2) | 0, ((side - ch) / 2) | 0, cw, ch);

  const pngAt = (size) => {
    const o = createCanvas(size, size);
    const octx = o.getContext('2d');
    octx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in octx) octx.imageSmoothingQuality = 'high';
    octx.drawImage(sq, 0, 0, side, side, 0, 0, size, size);
    return o.toBuffer('image/png');
  };
  const ico = (sizes) => packIco(sizes.map(s => ({ size: s, data: pngAt(s) })));

  const winIco = path.join(root, 'build', 'icons', 'win', 'icon.ico');
  const trayIco = path.join(root, 'resources', 'tray', 'tray-icon.ico');
  const trayPng = path.join(root, 'resources', 'tray', 'tray-icon.png');
  fs.mkdirSync(path.dirname(winIco), { recursive: true });
  fs.mkdirSync(path.dirname(trayIco), { recursive: true });

  fs.writeFileSync(winIco, ico([256, 128, 64, 48, 32, 16]));
  fs.writeFileSync(trayIco, ico([48, 32, 16]));
  fs.writeFileSync(trayPng, pngAt(256));

  console.log(`Source ${W}x${H} -> cropped ${cw}x${ch} (square ${side})`);
  console.log(`Wrote ${path.relative(root, winIco)} (${fs.statSync(winIco).size} b)`);
  console.log(`Wrote ${path.relative(root, trayIco)} (${fs.statSync(trayIco).size} b)`);
  console.log(`Wrote ${path.relative(root, trayPng)}`);
}
main().catch(e => { console.error(e); process.exit(1); });
