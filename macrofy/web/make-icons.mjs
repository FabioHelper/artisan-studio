// Generates the app icons (a plate seen from above) as PNG files with Node built-ins only.
//   node web/make-icons.mjs        writes web/app/icons/icon-{180,192,512}.png (committed; rerun only to restyle)
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

const GREEN = [31, 122, 77]; const WHITE = [255, 255, 255]; const LIGHT = [214, 236, 222];
/** Colour at a point in [0,1]^2: green field, white plate rim, pale well, green centre dot. */
function colourAt(x, y) {
  const d = Math.hypot(x - 0.5, y - 0.5);
  if (d < 0.07) return GREEN;
  if (d < 0.27) return LIGHT;
  if (d < 0.36) return WHITE;
  return GREEN;
}
function png(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1)); const S = 3; // 3x3 supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const c = colourAt((x + (i + 0.5) / S) / size, (y + (j + 0.5) / S) / size); acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; }
      for (let k = 0; k < 3; k++) raw[y * (size * 3 + 1) + 1 + x * 3 + k] = Math.round(acc[k] / (S * S));
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), 'app', 'icons');
mkdirSync(dir, { recursive: true });
for (const size of [180, 192, 512]) { writeFileSync(join(dir, `icon-${size}.png`), png(size)); console.log(`icon-${size}.png`); }
