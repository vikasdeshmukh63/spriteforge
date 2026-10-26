import {
  buildCanvas, decodeToCanvas, crop, resize, keyMagenta, thresholdAlpha, alphaBBox,
  extractPalette, snapToPalette, encode, blank, paste, layoutMeta,
} from "./image.js";
import { tilePrompt } from "./prompts.js";
import { pool } from "./util.js";

const CELL_PX = 256, COLS = 4, INSET = 8;
const TILE_WORDS = /(floor|wall|carpet|ground|grass|pavement|tile|ceiling)/i;

export function normalizeSpecs(tiles) {
  return tiles.map((t) => {
    const s = typeof t === "string" ? { name: t } : t;
    return {
      name: s.name,
      desc: s.description ?? s.name,
      kind: s.kind ?? (TILE_WORDS.test(s.name) ? "tile" : "object"),
      span: s.span ?? [1, 1], // size in tiles [w, h]
    };
  });
}

async function readItems(modelOut, layout, specs, tileSize) {
  const canvas = await decodeToCanvas(modelOut, layout.width, layout.height);
  const out = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const bw = tileSize * spec.span[0], bh = tileSize * spec.span[1];
    const ox = (i % layout.cols) * CELL_PX + INSET, oy = Math.floor(i / layout.cols) * CELL_PX + INSET;
    const region = crop(canvas, ox, oy, CELL_PX - 2 * INSET, CELL_PX - 2 * INSET);
    if (spec.kind === "tile") {
      const t = await resize(region, bw, bh);
      for (let p = 3; p < t.data.length; p += 4) t.data[p] = 255;
      out.push({ raw: t, ok: true });
      continue;
    }
    keyMagenta(region);
    thresholdAlpha(region);
    const bb = alphaBBox(region);
    if (!bb || bb.count < 12) { out.push({ raw: blank(bw, bh), ok: false }); continue; }
    const trimmed = crop(region, bb.x0, bb.y0, bb.w, bb.h);
    const k = Math.min(bw / bb.w, bh / bb.h);
    const w = Math.max(1, Math.round(bb.w * k)), h = Math.max(1, Math.round(bb.h * k));
    const small = thresholdAlpha(await resize(trimmed, w, h));
    const box = blank(bw, bh);
    paste(box, small, Math.floor((bw - w) / 2), bh - h); // bottom-centre
    out.push({ raw: box, ok: true });
  }
  return out;
}

export async function makeTileset({
  userPrompt, tiles, tileSize = 32, style, generate, retries = 2, chunkSize = 16,
  concurrency = 3, snap = true, paletteSize = 32, columns = 16, maxFailRatio = 0.15, onProgress,
}) {
  const specs = normalizeSpecs(tiles);
  const chunks = [];
  for (let i = 0; i < specs.length; i += chunkSize) chunks.push(specs.slice(i, i + chunkSize));
  const report = { items: specs.length, apiCalls: 0, failed: [] };
  let done = 0;
  const tick = () => onProgress?.({ stage: "tiles", done: ++done, total: chunks.length });

  async function runChunk(chunk, anchorPng, idx) {
    const layout = await buildCanvas(chunk.map(() => null), { cols: COLS, cellPx: CELL_PX, frameW: CELL_PX - 16, frameH: CELL_PX - 16 });
    const prompt = tilePrompt({ user: userPrompt, items: chunk, cols: layout.cols, rows: layout.rows, style, hasAnchor: !!anchorPng });
    let best = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      report.apiCalls++;
      const out = await generate({
        prompt, images: [...(anchorPng ? [anchorPng] : []), layout.png],
        salt: `tiles${idx}-${attempt}`, meta: { kind: "tiles", specs: chunk, ...layoutMeta(layout) },
      });
      const items = await readItems(out, layout, chunk, tileSize);
      const fails = items.filter((x) => !x.ok).length;
      if (!best || fails < best.fails) best = { items, fails };
      if (fails / chunk.length <= maxFailRatio) break;
    }
    return best;
  }

  const first = await runChunk(chunks[0], null, 0);
  const palette = snap ? extractPalette(first.items.map((x) => x.raw), paletteSize) : [];
  const finish = (r) => { if (snap) r.items.forEach((x) => snapToPalette(x.raw, palette)); return r; };
  finish(first); tick();
  let anchorPng = null;
  if (chunks.length > 1) {
    // show the model a contact sheet of what it already drew
    const thumbs = first.items.map((x) => x.raw);
    const side = Math.max(...thumbs.map((t) => Math.max(t.width, t.height)));
    const framed = thumbs.map((t) => { const b = blank(side, side); paste(b, t, 0, side - t.height); return b; });
    anchorPng = (await buildCanvas(framed, { cols: COLS, cellPx: CELL_PX, frameW: side, frameH: side })).png;
  }
  const rest = await pool(chunks.slice(1), concurrency, async (c, i) => { const r = finish(await runChunk(c, anchorPng, i + 1)); tick(); return r; });
  const results = [first, ...rest];

  // shelf-pack into one sheet
  const all = results.flatMap((r, ci) => r.items.map((it, i) => ({ ...it, spec: chunks[ci][i] })));
  const maxW = columns * tileSize;
  let x = 0, y = 0, shelf = 0;
  const placed = all.map((it) => {
    const { width: w, height: h } = it.raw;
    if (x + w > maxW) { x = 0; y += shelf; shelf = 0; }
    const p = { it, x, y }; x += w; shelf = Math.max(shelf, h); return p;
  });
  const sheet = blank(maxW, y + shelf);
  const frames = {};
  for (const { it, x: px, y: py } of placed) {
    paste(sheet, it.raw, px, py);
    frames[it.spec.name] = { x: px, y: py, w: it.raw.width, h: it.raw.height, kind: it.spec.kind };
    if (!it.ok) report.failed.push({ name: it.spec.name, reasons: ["nothing drawn"] });
  }
  return { png: await encode(sheet), atlas: { tileSize, width: sheet.width, height: sheet.height, frames }, report };
}
