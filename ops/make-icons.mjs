// Relay PWA アイコン生成 (依存なし・純 Node.js)。
// 使い方: node ops/make-icons.mjs
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

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

// 512 基準で描画し、最近傍で縮小。モチーフ: 濃紺グラデ + 吹き出し + R。
function render(size) {
  const S = 512;
  const px = Buffer.alloc(S * S * 4);
  const bubble = (x, y) => {
    // 吹き出し: 角丸 rect + しっぽ (512 座標系)
    const inRound = (px0, py0, w, h, r) => {
      const dx = Math.max(px0 - x, 0, x - (px0 + w));
      const dy = Math.max(py0 - y, 0, y - (py0 + h));
      if (dx === 0 && dy === 0) return true;
      const cx = Math.min(Math.max(x, px0 + r), px0 + w - r);
      const cy = Math.min(Math.max(y, py0 + r), py0 + h - r);
      return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
    };
    if (inRound(106, 118, 300, 220, 56)) return true;
    // しっぽ (三角形近似)
    if (x >= 170 && x <= 250 && y >= 330 && y <= 400 && y - 330 < (250 - x) * 0.9) return true;
    return false;
  };
  const inR = (x, y) => {
    // R の簡易ラスタ: 縦棒 + 上部ループ + 脚
    const vbar = x >= 208 && x <= 244 && y >= 168 && y <= 292;
    const top = y >= 168 && y <= 204 && x >= 208 && x <= 300 && (y <= 180 || y >= 192 || x >= 288);
    const mid = y >= 204 && y <= 226 && x >= 208 && x <= 292;
    const leg = y >= 226 && y <= 292 && x >= 244 + (y - 226) * 0.85 && x <= 244 + (y - 226) * 0.85 + 30;
    return vbar || top || mid || leg;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const t = y / S;
      let r = 26 + 22 * t;
      let g = 30 + 30 * t;
      let b = 46 + 62 * t;
      if (bubble(x, y)) {
        r = 91; g = 140; b = 255;
        const shade = 0.92 + 0.08 * (x / S);
        r *= shade; g *= shade; b *= shade;
      }
      if (inR(x, y)) {
        r = 255; g = 255; b = 255;
      }
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  }
  if (size === S) return px;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.floor((x * S) / size);
      const sy = Math.floor((y * S) / size);
      px.copy(out, (y * size + x) * 4, (sy * S + sx) * 4, (sy * S + sx) * 4 + 4);
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

fs.mkdirSync(OUT, { recursive: true });
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  fs.writeFileSync(path.join(OUT, name), png(size));
  console.log(`wrote icons/${name}`);
}
