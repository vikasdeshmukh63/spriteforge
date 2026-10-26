import {
  buildCanvas, decodeToCanvas, crop, resize, keyMagenta, thresholdAlpha, extractPalette,
  snapToPalette, encode, decode, blank, paste, layoutMeta,
} from "./image.js";
import { designPrompt, dressPrompt } from "./prompts.js";
import { compareFrame } from "./validate.js";
import { pool } from "./util.js";

const DESIGN_CELL_PX = 512;
const CHUNK_CELL_PX = 256;
const CHUNK_COLS = 4;

/** Model output -> cell-sized, keyed, hard-alpha frames. */
async function readFrames(modelOut, layout, n, cell) {
  const canvas = await decodeToCanvas(modelOut, layout.width, layout.height);
  keyMagenta(canvas);
  const frames = [];
  for (let i = 0; i < n; i++) {
    const o = layout.origin(i);
    const region = crop(canvas, o.x, o.y, cell.w * layout.scale, cell.h * layout.scale);
    const small = await resize(region, cell.w, cell.h);
    frames.push(thresholdAlpha(small));
  }
  return frames;
}

const frameCanvas = (frames, cell, cols, cellPx) =>
  buildCanvas(frames, { cols, cellPx, frameW: cell.w, frameH: cell.h });

/** Step 1: dress the front-facing frame once. The person can review this before the full run. */
export async function makeDesign({ template, userPrompt, generate, style, retries = 1, paletteSize = 24 }) {
  const cell = template.cell;
  const { row, col } = template.manifest.designFrame;
  const base = template.frame(row, col);
  const layout = await frameCanvas([base], cell, 1, DESIGN_CELL_PX);
  let best = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const out = await generate({
      prompt: designPrompt(userPrompt, style), images: [layout.png],
      salt: `design${attempt}`, meta: { kind: "design", ...layoutMeta(layout) },
    });
    const [frame] = await readFrames(out, layout, 1, cell);
    const check = compareFrame(base, frame);
    if (!best || check.coverage > best.check.coverage) best = { frame, check };
    if (check.ok) break;
  }
  snapToPalette(best.frame, extractPalette([best.frame], paletteSize));
  return designFromFrame(best.frame, cell, best.check);
}

async function designFromFrame(frame, cell, check) {
  const ref = await frameCanvas([frame], cell, 1, DESIGN_CELL_PX);
  return { png: await encode(frame), ref: ref.png, check };
}

/** Accept a design the person supplied (a cell-sized png of the dressed front frame). */
export async function designFromPng(template, buf) {
  const cell = template.cell;
  const frame = thresholdAlpha(await resize(await decode(buf), cell.w, cell.h, "nearest"));
  return designFromFrame(frame, cell, null);
}

/** Step 2: dress every frame of the selected animations. */
export async function dressSheet({
  template, groups, userPrompt, design, generate, retries = 2, chunkSize = 16,
  concurrency = 3, snap = true, paletteSize = 32, validation = {}, maxFailRatio = 0.15, onProgress,
}) {
  const cell = template.cell;
  const targets = [];
  let outRow = 0;
  for (const g of groups) {
    for (let r = 0; r < g.rows; r++)
      for (let c = 0; c < g.frames; c++)
        targets.push({ tRow: g.startRow + r, col: c, outRow: outRow + r, outCol: c, group: g.name, rowName: g.rowNames?.[r] ?? `row${r}` });
    outRow += g.rows;
  }
  const columns = Math.max(...groups.map((g) => g.frames));
  const chunks = [];
  for (let i = 0; i < targets.length; i += chunkSize) chunks.push(targets.slice(i, i + chunkSize));

  let done = 0;
  const tick = (message) => onProgress?.({ stage: "dress", done: ++done, total: chunks.length, message });
  const report = { frames: targets.length, chunks: chunks.length, apiCalls: 0, failed: [] };

  async function runChunk(chunk, anchorPng, idx) {
    const bodies = chunk.map((t) => template.frame(t.tRow, t.col));
    const layout = await frameCanvas(bodies, cell, CHUNK_COLS, CHUNK_CELL_PX);
    const images = [layout.png, design.ref, ...(anchorPng ? [anchorPng] : [])];
    const prompt = dressPrompt({ user: userPrompt, count: chunk.length, cols: layout.cols, rows: layout.rows, hasAnchor: !!anchorPng });
    let best = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      report.apiCalls++;
      const out = await generate({ prompt, images, salt: `chunk${idx}-${attempt}`, meta: { kind: "dress", ...layoutMeta(layout) } });
      const frames = await readFrames(out, layout, chunk.length, cell);
      const checks = frames.map((f, i) => compareFrame(bodies[i], f, validation));
      const fails = checks.filter((c) => !c.ok).length;
      if (!best || fails < best.fails) best = { frames, checks, fails };
      if (fails / chunk.length <= maxFailRatio) break;
    }
    return best;
  }

  // First chunk defines the look (palette + anchor); the rest run in parallel.
  const first = await runChunk(chunks[0], null, 0);
  const palette = snap ? extractPalette(first.frames, paletteSize) : [];
  const finish = (res) => { if (snap) res.frames.forEach((f) => snapToPalette(f, palette)); return res; };
  finish(first);
  tick("look established");
  const anchorPng = chunks.length > 1 ? (await frameCanvas(first.frames, cell, CHUNK_COLS, CHUNK_CELL_PX)).png : null;
  const rest = await pool(chunks.slice(1), concurrency, async (chunk, i) => {
    const res = finish(await runChunk(chunk, anchorPng, i + 1));
    tick(`chunk ${i + 2}/${chunks.length}`);
    return res;
  });
  const results = [first, ...rest];

  // Assemble the sheet in the template's own grid.
  const sheet = blank(columns * cell.w, outRow * cell.h);
  results.forEach((res, ci) => {
    res.frames.forEach((f, i) => {
      const t = chunks[ci][i];
      paste(sheet, f, t.outCol * cell.w, t.outRow * cell.h);
      if (!res.checks[i].ok) report.failed.push({ animation: t.group, row: t.rowName, col: t.col, reasons: res.checks[i].reasons });
    });
  });

  const atlas = {
    cell: { w: cell.w, h: cell.h },
    columns,
    rows: outRow,
    width: sheet.width,
    height: sheet.height,
    animations: {},
  };
  let rowCursor = 0;
  for (const g of groups) {
    atlas.animations[g.name] = {
      frames: g.frames, fps: g.fps ?? 8,
      rows: Array.from({ length: g.rows }, (_, r) => ({
        name: g.rowNames?.[r] ?? `row${r}`, row: rowCursor + r, y: (rowCursor + r) * cell.h,
        firstFrame: (rowCursor + r) * columns, // index for engines that number frames row-major (Phaser)
      })),
    };
    rowCursor += g.rows;
  }
  return { png: await encode(sheet), atlas, report, palette };
}
