// iOS AppIcon.appiconset + 1024 marketing icon 生成 (依存なし)。
// 使い方: node ops/make-ios-assets.mjs
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset');

function crc32(buf) {
  let table = crc32.t;
  if (!table) {
    table = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// 512 基準の図形を任意サイズでサンプリング
function inBubble(x, y) {
  const inRound = (x0, y0, w, h, r) => {
    const dx = Math.max(x0 - x, 0, x - (x0 + w));
    const dy = Math.max(y0 - y, 0, y - (y0 + h));
    if (dx === 0 && dy === 0) return true;
    const cx = Math.min(Math.max(x, x0 + r), x0 + w - r);
    const cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  if (inRound(106, 118, 300, 220, 56)) return true;
  return x >= 170 && x <= 250 && y >= 330 && y <= 400 && y - 330 < (250 - x) * 0.9;
}

function inR(x, y) {
  const vbar = x >= 208 && x <= 244 && y >= 168 && y <= 292;
  const top = y >= 168 && y <= 204 && x >= 208 && x <= 300 && (y <= 180 || y >= 192 || x >= 288);
  const mid = y >= 204 && y <= 226 && x >= 208 && x <= 292;
  const leg = y >= 226 && y <= 292 && x >= 244 + (y - 226) * 0.85 && x <= 244 + (y - 226) * 0.85 + 30;
  return vbar || top || mid || leg;
}

function render(size) {
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = ((px + 0.5) * 512) / size;
      const y = ((py + 0.5) * 512) / size;
      const t = y / 512;
      let r = 26 + 22 * t;
      let g = 30 + 30 * t;
      let b = 46 + 62 * t;
      if (inBubble(x, y)) {
        const shade = 0.92 + 0.08 * (x / 512);
        r = 91 * shade; g = 140 * shade; b = 255 * shade;
      }
      if (inR(x, y)) {
        r = 255; g = 255; b = 255;
      }
      const i = (py * size + px) * 4;
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
    }
  }
  return out;
}

function png(size) {
  const raw = render(size);
  const stride = size * 4;
  const scan = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    scan[y * (stride + 1)] = 0;
    raw.copy(scan, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(scan, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const ICONS = [
  ['iphone', '20x20', '2x', 40], ['iphone', '20x20', '3x', 60],
  ['iphone', '29x29', '2x', 58], ['iphone', '29x29', '3x', 87],
  ['iphone', '40x40', '2x', 80], ['iphone', '40x40', '3x', 120],
  ['iphone', '60x60', '2x', 120], ['iphone', '60x60', '3x', 180],
  ['ipad', '20x20', '1x', 20], ['ipad', '20x20', '2x', 40],
  ['ipad', '29x29', '1x', 29], ['ipad', '29x29', '2x', 58],
  ['ipad', '40x40', '1x', 40], ['ipad', '40x40', '2x', 80],
  ['ipad', '76x76', '1x', 76], ['ipad', '76x76', '2x', 152],
  ['ipad', '83.5x83.5', '2x', 167],
  ['ios-marketing', '1024x1024', '1x', 1024],
];

fs.mkdirSync(OUT, { recursive: true });
const images = [];
for (const [idiom, size, scale, px] of ICONS) {
  const name = `Icon-${px}.png`;
  fs.writeFileSync(path.join(OUT, name), png(px));
  images.push({ idiom, size, scale, filename: name });
  console.log(`wrote AppIcon.appiconset/${name}`);
}
fs.writeFileSync(
  path.join(OUT, 'Contents.json'),
  JSON.stringify({ images, info: { version: 1, author: 'relay' } }, null, 2),
);
// App Store Connect アップロード用にも 1024 を複製
fs.writeFileSync(path.join(ROOT, 'ops', 'marketing-icon-1024.png'), png(1024));
console.log('wrote ops/marketing-icon-1024.png');
