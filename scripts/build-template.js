#!/usr/bin/env node
// One-time step: take a messy base-body sheet (uneven spacing) and repack it
// into a uniform grid + manifest.json that the rest of the package relies on.
//
//   node scripts/build-template.js path/to/body-sheet.png [outDir]
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [src, outDir = path.join(here, "..", "template")] = process.argv.slice(2);
if (!src) {
  console.error("usage: node scripts/build-template.js <body-sheet.png> [outDir]");
  process.exit(1);
}

const CELL_W = 48, CELL_H = 48; // headroom for hats, coats, held tools
const BASELINE = 44;            // feet sit on this y inside every cell
const GROUP_ROWS = 4;           // rows with the same frame count are grouped, max 4
const ALPHA = 10;

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const alphaAt = (x, y) => data[(y * W + x) * 4 + 3];

function runs(flags) {
  const out = []; let s = -1;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] && s < 0) s = i;
    if (!flags[i] && s >= 0) { out.push([s, i]); s = -1; }
  }
  if (s >= 0) out.push([s, flags.length]);
  return out;
}

// 1. rows = horizontal projection of opaque pixels
const rowFlags = new Uint8Array(H);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) if (alphaAt(x, y) > ALPHA) { rowFlags[y] = 1; break; }

// 2. frames = vertical projection inside each row band
const rows = runs(rowFlags).map(([y0, y1]) => {
  const colFlags = new Uint8Array(W);
  for (let y = y0; y < y1; y++)
    for (let x = 0; x < W; x++) if (alphaAt(x, y) > ALPHA) colFlags[x] = 1;
  return { y0, y1, frames: runs(colFlags) };
});

const columns = Math.max(...rows.map((r) => r.frames.length));
const SW = columns * CELL_W, SH = rows.length * CELL_H;
const sheet = Buffer.alloc(SW * SH * 4);

// 3. repack: centroid-x to cell centre, row's bottom edge on the baseline
rows.forEach((row, ri) => {
  const h = row.y1 - row.y0;
  if (h > CELL_H) throw new Error(`row ${ri} is ${h}px tall, bigger than the ${CELL_H}px cell`);
  const top = Math.max(0, BASELINE - h);
  row.frames.forEach(([x0, x1], ci) => {
    const w = x1 - x0;
    if (w > CELL_W) throw new Error(`frame ${ri}:${ci} is ${w}px wide, bigger than the ${CELL_W}px cell`);
    let sum = 0, cnt = 0;
    for (let y = row.y0; y < row.y1; y++)
      for (let x = x0; x < x1; x++) if (alphaAt(x, y) > ALPHA) { sum += x - x0; cnt++; }
    const cx = cnt ? sum / cnt : w / 2;
    const dx = Math.min(Math.max(Math.round(CELL_W / 2 - cx), 0), CELL_W - w);
    for (let yy = 0; yy < h && top + yy < CELL_H; yy++) {
      const s = ((row.y0 + yy) * W + x0) * 4;
      const d = ((ri * CELL_H + top + yy) * SW + ci * CELL_W + dx) * 4;
      data.copy(sheet, d, s, s + w * 4);
    }
  });
});

// 4. group rows into animations (names are placeholders: rename them!)
const groups = [];
for (let r = 0; r < rows.length;) {
  const n = rows[r].frames.length;
  let k = 1;
  while (k < GROUP_ROWS && r + k < rows.length && rows[r + k].frames.length === n) k++;
  const id = `anim${String(groups.length + 1).padStart(2, "0")}`;
  groups.push({
    id, name: id, startRow: r, rows: k, frames: n, fps: 8,
    rowNames: Array.from({ length: k }, (_, i) => `row${i}`),
  });
  r += k;
}

const manifest = {
  version: 1,
  cell: { w: CELL_W, h: CELL_H },
  baseline: BASELINE,
  columns,
  rows: rows.length,
  designFrame: { row: 0, col: 0 }, // a front-facing frame used for the outfit design step
  groups,
};

await fs.mkdir(outDir, { recursive: true });
await sharp(sheet, { raw: { width: SW, height: SH, channels: 4 } }).png().toFile(path.join(outDir, "body.png"));
await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`template: ${rows.length} rows, ${columns} columns, ${rows.reduce((a, r) => a + r.frames.length, 0)} frames, ${groups.length} groups -> ${outDir}`);
