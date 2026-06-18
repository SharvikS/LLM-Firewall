#!/usr/bin/env node
// Generates the extension's toolbar/store icons (16/32/48/128) as PNGs into
// browser-extension/icons/. No native deps — it rasterizes the canonical TITAN
// mark (the same shield + upward-arrow + ascending-bars line-art used by the
// admin portal and the in-app Logo) as dark strokes on the accent-gradient tile,
// then encodes the PNG by hand using Node's built-in zlib. This keeps the logo
// identical everywhere. Re-run with `npm run icons` after tweaking.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'icons');
const SIZES = [16, 32, 48, 128];
const SS = 4; // supersampling factor for anti-aliasing

// Palette — matches the portal's accent tile (var(--accent)) with the mark in
// the dark base colour (var(--bg-main)).
const TILE_TL = [0x33, 0x6f, 0xf2]; // brighter accent (top-left)
const TILE_BR = [0x1d, 0x4e, 0xd8]; // accent-hover (bottom-right)
const MARK = [0x0d, 0x10, 0x14];    // var(--bg-main)

// ── Geometry: the TitanLogo paths sampled to polylines in a 24×24 viewBox ────
function cubic(p0, c1, c2, p3, n) {
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const x = u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0];
    const y = u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1];
    pts.push([x, y]);
  }
  return pts;
}

// Shield: M12 2.5 20 6 v6 C…(right) (bottom tip) C…(left) → 4 12 V6 Z
const shield = [
  [12, 2.5], [20, 6], [20, 12],
  ...cubic([20, 12], [20, 16.6], [16.6, 20], [12, 21.5], 10),
  ...cubic([12, 21.5], [7.4, 20], [4, 16.6], [4, 12], 10),
  [4, 6], [12, 2.5],
];
// Arrow + ascending bars.
const arrow = [[8.6, 11.2], [12, 7.8], [15.4, 11.2]];
const stem = [[12, 7.8], [12, 16.2]];
const barL = [[8.8, 13.4], [8.8, 16.2]];
const barR = [[15.2, 12.6], [15.2, 16.2]];

// Segment list (each: [ax, ay, bx, by]) built from the polylines.
function segs(poly, out) {
  for (let i = 0; i < poly.length - 1; i++) out.push([...poly[i], ...poly[i + 1]]);
}
const SEGMENTS = [];
[shield, arrow, stem, barL, barR].forEach((p) => segs(p, SEGMENTS));
const STROKE_W = 1.9; // in viewBox units (matches TitanLogo strokeWidth)

function distToSeg(px, py, [ax, ay, bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-6;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// ── PNG encoder (IHDR/IDAT/IEND with CRC32) ─────────────────────────────────
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
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ── Rasterizer ───────────────────────────────────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }
function mix(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }

// Rounded-tile coverage (corner radius as a fraction of side).
function inTile(nx, ny, r) {
  const x = Math.min(nx, 1 - nx), y = Math.min(ny, 1 - ny);
  if (x >= r || y >= r) return true;
  const dx = r - x, dy = r - y;
  return dx * dx + dy * dy <= r * r;
}

function renderIcon(size) {
  const S = size * SS;
  const acc = new Float32Array(size * size * 4);
  const radius = 0.22;
  // Map the 24×24 mark into the centred 60% box of the tile.
  const markScale = (S * 0.6) / 24;
  const markOffset = S * 0.2;
  const halfStroke = (STROKE_W / 2) * markScale;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const nx = (x + 0.5) / S, ny = (y + 0.5) / S;
      let rgb = null, a = 0;
      if (inTile(nx, ny, radius)) {
        rgb = mix(TILE_TL, TILE_BR, (nx + ny) / 2); // 135° gradient
        a = 255;
        // Mark: dark stroke where near any segment.
        const vx = (x + 0.5 - markOffset) / markScale;
        const vy = (y + 0.5 - markOffset) / markScale;
        let dmin = Infinity;
        for (const s of SEGMENTS) {
          const d = distToSeg(vx, vy, s);
          if (d < dmin) { dmin = d; if (dmin <= 0) break; }
        }
        if (dmin <= STROKE_W / 2) rgb = MARK;
      }
      // accumulate into the downsampled buffer
      const ox = (x / SS) | 0, oy = (y / SS) | 0;
      const i = (oy * size + ox) * 4;
      if (a) { acc[i] += rgb[0]; acc[i + 1] += rgb[1]; acc[i + 2] += rgb[2]; acc[i + 3] += 255; }
    }
  }

  const rgba = Buffer.alloc(size * size * 4);
  const per = SS * SS;
  for (let p = 0; p < size * size; p++) {
    const i = p * 4;
    const cov = acc[i + 3] / 255 / per; // 0..1 coverage
    rgba[i] = cov ? Math.round(acc[i] / (acc[i + 3] / 255)) : 0;
    rgba[i + 1] = cov ? Math.round(acc[i + 1] / (acc[i + 3] / 255)) : 0;
    rgba[i + 2] = cov ? Math.round(acc[i + 2] / (acc[i + 3] / 255)) : 0;
    rgba[i + 3] = Math.round(cov * 255);
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
