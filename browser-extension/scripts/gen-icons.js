#!/usr/bin/env node
// Generates the extension's placeholder icons (16/32/48/128) as PNGs into
// browser-extension/icons/. No native deps — it rasterizes a simple brand mark
// (a rounded blue tile with a white shield + keyhole) and encodes the PNG by
// hand using Node's built-in zlib. Re-run with `npm run icons` after tweaking.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'icons');
const SIZES = [16, 32, 48, 128];

// Brand palette.
const BG = [0x25, 0x63, 0xeb]; // #2563eb  brand blue
const BG2 = [0x1e, 0x40, 0xaf]; // #1e40af  darker blue (subtle vertical shade)
const FG = [0xff, 0xff, 0xff]; // white shield
const HOLE = [0x1d, 0x4e, 0xd8]; // keyhole tint

// ── tiny CRC32 (PNG chunk checksums) ──────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  // 10,11,12 default (deflate / adaptive / no interlace)

  // Prepend a filter byte (0 = none) per scanline.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── rasterizer ─────────────────────────────────────────────────────────────
function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

// Point-in-shield test in normalized [0,1] coords. A classic crest: flat top,
// straight sides, curving to a point at the bottom.
function inShield(nx, ny) {
  // shield spans x∈[0.22,0.78], y∈[0.20,0.82]
  if (nx < 0.22 || nx > 0.78 || ny < 0.20 || ny > 0.82) return false;
  const cx = (nx - 0.5) / 0.28;            // -1..1 across the shield width
  const top = 0.20, bot = 0.82;
  const ty = (ny - top) / (bot - top);     // 0 at top, 1 at bottom tip
  // allowed half-width shrinks toward the tip (quadratic taper)
  const halfW = 1 - Math.pow(Math.max(0, ty - 0.45) / 0.55, 1.6);
  return Math.abs(cx) <= halfW;
}

// Keyhole: a small disc with a tapering stem, centered in the shield.
function inKeyhole(nx, ny) {
  const dx = nx - 0.5, dy = ny - 0.45;
  if (dx * dx + dy * dy <= 0.006) return true;           // round head
  if (Math.abs(nx - 0.5) < 0.035 && ny > 0.45 && ny < 0.60) return true; // stem
  return false;
}

// Rounded-corner mask for the background tile.
function inTile(nx, ny, r) {
  const x = Math.min(nx, 1 - nx), y = Math.min(ny, 1 - ny);
  if (x >= r && y >= r) return true;
  if (x < r && y < r) {
    const dx = r - x, dy = r - y;
    return dx * dx + dy * dy <= r * r;
  }
  return x >= r || y >= r ? (x >= 0 && y >= 0) : true;
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = 0.22; // corner radius as fraction of side
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size, ny = (y + 0.5) / size;
      const i = (y * size + x) * 4;
      if (!inTile(nx, ny, radius)) {
        rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0; // transparent
        continue;
      }
      let col;
      if (inKeyhole(nx, ny)) col = HOLE;
      else if (inShield(nx, ny)) col = FG;
      else col = [lerp(BG[0], BG2[0], ny), lerp(BG[1], BG2[1], ny), lerp(BG[2], BG2[2], ny)];
      rgba[i] = col[0]; rgba[i + 1] = col[1]; rgba[i + 2] = col[2]; rgba[i + 3] = 255;
    }
  }
  return encodePNG(size, size, rgba);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const png = renderIcon(size);
  const file = path.join(OUT_DIR, `icon-${size}.png`);
  fs.writeFileSync(file, png);
  console.log(`wrote ${path.relative(path.join(__dirname, '..'), file)} (${png.length} bytes)`);
}
