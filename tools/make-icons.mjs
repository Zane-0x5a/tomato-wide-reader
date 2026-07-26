// Generates the extension icons as PNGs with zero dependencies.
// The machine has no ImageMagick / Inkscape / sharp, so the PNG bytes are
// encoded here directly (zlib is in Node's stdlib).
//
// Design intent: the product's own reading surface, not a borrowed identity.
// A cream page tile holding two text columns — literally the thing the
// extension does — in the palette from DESIGN_SYSTEM.md. Deliberately shares
// nothing with Fanqie's logo or brand marks.
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
const CREAM = [0xf6, 0xf3, 0xed];
const INK = [0x29, 0x28, 0x24];
const INK_SOFT = [0x5a, 0x58, 0x52];
const MUTED = [0x71, 0x6e, 0x67];
const ACCENT = [0xa9, 0x4b, 0x3b];

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

function drawIcon(size) {
  const S = size * SS;
  const buf = Buffer.alloc(S * S * 4, 0); // fully transparent

  const set = (x, y, c, a = 255) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = a;
  };
  const rect = (x, y, w, h, c, a = 255) => {
    const x0 = Math.round(x), y0 = Math.round(y);
    for (let yy = y0; yy < Math.round(y + h); yy++)
      for (let xx = x0; xx < Math.round(x + w); xx++) set(xx, yy, c, a);
  };

  // page tile with rounded corners
  const r = S * 0.2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = Math.max(r - x, x - (S - 1 - r), 0);
      const dy = Math.max(r - y, y - (S - 1 - r), 0);
      if (Math.hypot(dx, dy) <= r) set(x, y, CREAM);
    }
  }

  const margin = S * 0.185;
  const gutter = S * 0.1;
  const colW = (S - 2 * margin - gutter) / 2;
  const top = S * 0.225;
  const colH = S * 0.55;
  const rightX = margin + colW + gutter;

  const detailed = size >= 48;

  if (detailed) {
    // text lines: the two-column spread, readable as type at large sizes
    const lineH = S * 0.05;
    const period = S * 0.098;
    for (const x of [margin, rightX]) {
      for (let i = 0; ; i++) {
        const y = top + i * period;
        if (y + lineH > top + colH) break;
        // last line of each column runs short, like real ragged text
        const isLast = y + period + lineH > top + colH;
        rect(x, y, isLast ? colW * 0.62 : colW, lineH, INK);
      }
    }
    // faint centre rule — DESIGN_SYSTEM: divider at very low opacity
    rect(margin + colW + gutter / 2 - S * 0.006, top, S * 0.012, colH, MUTED, 46);
  } else {
    // at 16-32px individual lines turn to mush; show the two-column mass instead
    rect(margin, top, colW, colH, INK_SOFT);
    rect(rightX, top, colW, colH, INK_SOFT);
  }

  // progress marker — the one place DESIGN_SYSTEM allows the accent
  const barH = Math.max(SS, S * 0.038);
  const barY = top + colH + S * 0.085;
  rect(margin, barY, colW * 0.72, barH, ACCENT);
  rect(margin + colW * 0.72, barY, (S - 2 * margin) - colW * 0.72, barH, MUTED, 60);

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
