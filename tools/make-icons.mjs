// Generates the extension icons as PNGs with zero dependencies.
// The machine has no ImageMagick / Inkscape / sharp, so the PNG bytes are
// encoded here directly (zlib is in Node's stdlib).
//
// Design: a page caught mid page-turn — its leading edge lifted and leaning
// right, revealing the next page beneath. That is literally what the extension
// does (pagination replacing scroll), and a bright page silhouette on a dark
// tile is the one composition that survives a 16px toolbar, where fine text
// lines collapse into mush. Colours are the product's own tokens from
// DESIGN_SYSTEM.md; nothing here echoes Fanqie's marks.
//
//   node tools/make-icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public');
// The store logo is listing artwork, not part of the shipped extension, so it
// must NOT land in public/ (WXT copies that verbatim into the zip).
const STORE_DIR = join(ROOT, 'store-assets');
const SIZES = [16, 32, 48, 128, 300];

// DESIGN_SYSTEM.md tokens
const FIELD = [0x1d, 0x1d, 0x1b]; // dark reading background
const PAGE = [0xf6, 0xf3, 0xed]; // cream paper
const UNDER = [0x85, 0x82, 0x7b]; // the page beneath, in shade
const ACCENT = [0xa9, 0x4b, 0x3b]; // terracotta; only ever a thin edge

// ---------- minimal PNG encoder ----------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([len, typed, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- drawing ----------

const SS = 4; // supersample factor, box-downsampled for antialiasing

// Geometry in 0..1 of the tile, so every size is the same picture.
const BLOCK_T = 0.225; // page block top
const BLOCK_B = 0.775; // page block bottom
const LEFT_X = 0.135; // left edge of the resting page
const SPINE_A = 0.478; // resting page ends
const SPINE_B = 0.496; // turning page starts (dark gap between = the spine)
const FOLD_X = 0.678; // lifted leading edge
const FOLD_RISE = 0.078; // how far that edge lifts above the block
const UNDER_R = 0.865; // right edge of the page beneath

function drawIcon(size) {
  const S = size * SS;
  const buf = Buffer.alloc(S * S * 4, 0); // transparent
  const P = (v) => v * S; // normalized → supersampled px

  // Below 32px the fine geometry is sub-pixel: the spine gap lands at ~0.3px
  // and the lifted edge's diagonal only contributes antialiasing haze, so the
  // whole thing turns to mush. Hint it like a font — snap every edge to a whole
  // device pixel, force the spine to exactly 1px, and drop the lift, keeping a
  // crisp page | spine | page | shade silhouette instead of a blurry one.
  const hinted = size < 32;
  const q = (v) => (hinted ? Math.round(v * size) / size : v);
  const blockT = q(BLOCK_T);
  const blockB = q(BLOCK_B);
  const leftX = q(LEFT_X);
  const foldX = q(FOLD_X);
  const underR = q(UNDER_R);
  const spineA = hinted ? q(SPINE_A) - 1 / size : SPINE_A;
  const spineB = hinted ? q(SPINE_A) : SPINE_B;
  const rise = hinted ? 0 : FOLD_RISE;

  const set = (x, y, c, a = 255) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = a;
  };

  const rect = (x, y, w, h, c, a = 255) => {
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++)
      for (let xx = Math.round(x); xx < Math.round(x + w); xx++) set(xx, yy, c, a);
  };

  // Scanline fill; pts are [x, y] pairs in supersampled space.
  const poly = (pts, c, a = 255) => {
    const ys = pts.map((p) => p[1]);
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const y1 = Math.min(S - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [xa, ya] = pts[i];
        const [xb, yb] = pts[(i + 1) % pts.length];
        if ((ya <= yc && yb > yc) || (yb <= yc && ya > yc)) {
          xs.push(xa + ((yc - ya) / (yb - ya)) * (xb - xa));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) set(x, y, c, a);
      }
    }
  };

  // 1. the dark reading field, as a rounded square
  const r = S * 0.2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = Math.max(r - x, x - (S - 1 - r), 0);
      const dy = Math.max(r - y, y - (S - 1 - r), 0);
      if (Math.hypot(dx, dy) <= r) set(x, y, FIELD);
    }
  }

  // 2. the page beneath, in shade — the thing being revealed
  const underInset = hinted ? 0 : 0.007;
  rect(P(foldX), P(blockT + underInset), P(underR - foldX), P(blockB - blockT - underInset), UNDER);

  // 3. the resting page
  rect(P(leftX), P(blockT), P(spineA - leftX), P(blockB - blockT), PAGE);

  // 4. the turning page: hinged at the spine, its leading edge lifted
  poly(
    [
      [P(spineB), P(blockT)],
      [P(foldX), P(blockT - rise)],
      [P(foldX), P(blockB - rise)],
      [P(spineB), P(blockB)],
    ],
    PAGE,
  );

  // 5. the accent, only ever a thin edge on the leading fold. At 16px it would
  // be sub-pixel and would just muddy the silhouette, so it is dropped there
  // rather than smeared.
  if (size >= 32) {
    const w = Math.max(SS, P(0.014));
    poly(
      [
        [P(foldX) - w, P(blockT - rise)],
        [P(foldX), P(blockT - rise)],
        [P(foldX), P(blockB - rise)],
        [P(foldX) - w, P(blockB - rise)],
      ],
      ACCENT,
    );
  }

  // ---------- downsample (premultiplied, so edges don't halo) ----------
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sr = 0, sg = 0, sb = 0, sa = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * S + (x * SS + dx)) * 4;
          const a = buf[i + 3];
          sr += buf[i] * a; sg += buf[i + 1] * a; sb += buf[i + 2] * a; sa += a;
        }
      }
      const o = (y * size + x) * 4;
      if (sa === 0) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; continue; }
      out[o] = Math.round(sr / sa);
      out[o + 1] = Math.round(sg / sa);
      out[o + 2] = Math.round(sb / sa);
      out[o + 3] = Math.round(sa / (SS * SS));
    }
  }
  return encodePng(size, size, out);
}

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(STORE_DIR, { recursive: true });
for (const size of SIZES) {
  const png = drawIcon(size);
  const isStore = size === 300;
  const name = isStore ? 'store-logo-300.png' : `icon-${size}.png`;
  writeFileSync(join(isStore ? STORE_DIR : OUT_DIR, name), png);
  console.log(`${isStore ? 'store-assets' : 'public'}/${name}  ${png.length} bytes`);
}
