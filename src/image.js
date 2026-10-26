// Pixel helpers. "raw" = { data: Buffer(RGBA), width, height }.
import sharp from "sharp";

export function blank(width, height, rgba = [0, 0, 0, 0]) {
  const data = Buffer.alloc(width * height * 4);
  if (rgba.some(Boolean)) for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { data, width, height };
}

export async function decode(input) {
  const { data, info } = await sharp(input)
    .toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export const encode = (raw) =>
  sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } }).png().toBuffer();

export async function resize(raw, width, height, kernel = "mitchell") {
  if (raw.width === width && raw.height === height) return raw;
  const { data, info } = await sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
    .resize(width, height, { fit: "fill", kernel }).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export function crop(raw, x, y, w, h) {
  const out = blank(w, h);
  for (let yy = 0; yy < h; yy++) {
    const sy = y + yy;
    if (sy < 0 || sy >= raw.height) continue;
    const sx0 = Math.max(0, x), sx1 = Math.min(raw.width, x + w);
    if (sx1 <= sx0) continue;
    raw.data.copy(out.data, (yy * w + (sx0 - x)) * 4, (sy * raw.width + sx0) * 4, (sy * raw.width + sx1) * 4);
  }
  return out;
}

/** Copy src's visible pixels (alpha >= 128) onto dst. */
export function paste(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) continue;
      const s = (y * src.width + x) * 4;
      if (src.data[s + 3] < 128) continue;
      const d = (ty * dst.width + tx) * 4;
      dst.data[d] = src.data[s]; dst.data[d + 1] = src.data[s + 1];
      dst.data[d + 2] = src.data[s + 2]; dst.data[d + 3] = 255;
    }
  }
  return dst;
}

export function upscale(raw, s) {
  const out = blank(raw.width * s, raw.height * s);
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) {
      const si = (Math.floor(y / s) * raw.width + Math.floor(x / s)) * 4;
      out.data.set(raw.data.subarray(si, si + 4), (y * out.width + x) * 4);
    }
  return out;
}

/** Make magenta-ish pixels transparent (in place). */
export function keyMagenta(raw, tol = 130) {
  const t2 = tol * tol, d = raw.data;
  for (let i = 0; i < d.length; i += 4) {
    const dr = d[i] - 255, dg = d[i + 1], db = d[i + 2] - 255;
    if (dr * dr + dg * dg + db * db < t2) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; }
  }
  return raw;
}

/** Hard 0/255 alpha: pixel art has no half-transparent pixels (in place). */
export function thresholdAlpha(raw, t = 128) {
  const d = raw.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] >= t) d[i + 3] = 255;
    else { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; }
  }
  return raw;
}

export function alphaBBox(raw) {
  let x0 = raw.width, y0 = raw.height, x1 = -1, y1 = -1, count = 0, sumX = 0;
  for (let y = 0; y < raw.height; y++)
    for (let x = 0; x < raw.width; x++)
      if (raw.data[(y * raw.width + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        count++; sumX += x;
      }
  return count ? { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, count, cx: sumX / count } : null;
}

/** Deterministic k-means palette over every opaque pixel of the given frames. */
export function extractPalette(raws, k = 32) {
  const px = [];
  for (const r of raws)
    for (let i = 0; i < r.data.length; i += 4)
      if (r.data[i + 3] >= 128) px.push([r.data[i], r.data[i + 1], r.data[i + 2]]);
  if (!px.length) return [];
  const step = Math.max(1, Math.floor(px.length / 8000));
  const s = px.filter((_, i) => i % step === 0);
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const centers = [s[0]];
  const dist = s.map((p) => d2(p, s[0]));
  while (centers.length < Math.min(k, s.length)) {
    let bi = 0; for (let i = 1; i < s.length; i++) if (dist[i] > dist[bi]) bi = i;
    if (dist[bi] === 0) break;
    centers.push(s[bi]);
    for (let i = 0; i < s.length; i++) dist[i] = Math.min(dist[i], d2(s[i], s[bi]));
  }
  for (let it = 0; it < 6; it++) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (const p of s) {
      let b = 0, bd = Infinity;
      for (let c = 0; c < centers.length; c++) { const d = d2(p, centers[c]); if (d < bd) { bd = d; b = c; } }
      acc[b][0] += p[0]; acc[b][1] += p[1]; acc[b][2] += p[2]; acc[b][3]++;
    }
    acc.forEach((a, c) => { if (a[3]) centers[c] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
  }
  return centers.map((c) => c.map(Math.round));
}

/** Replace every opaque pixel with its nearest palette colour (in place). */
export function snapToPalette(raw, palette) {
  if (!palette.length) return raw;
  const d = raw.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    let best = 0, bd = Infinity;
    for (let c = 0; c < palette.length; c++) {
      const p = palette[c];
      const dd = (d[i] - p[0]) ** 2 + (d[i + 1] - p[1]) ** 2 + (d[i + 2] - p[2]) ** 2;
      if (dd < bd) { bd = dd; best = c; }
    }
    d[i] = palette[best][0]; d[i + 1] = palette[best][1]; d[i + 2] = palette[best][2]; d[i + 3] = 255;
  }
  return raw;
}

/**
 * Lay frames out on a magenta canvas with grey cell borders. This is the image
 * we show the model: near-square, big cells, so it keeps the layout.
 * `frames[i]` may be null (empty cell). Returns the layout + png.
 */
export async function buildCanvas(frames, { cols, cellPx, frameW, frameH }) {
  const rows = Math.ceil(frames.length / cols);
  const scale = Math.max(1, Math.floor((cellPx - 16) / Math.max(frameW, frameH)));
  const width = cols * cellPx, height = rows * cellPx;
  const raw = blank(width, height, [255, 0, 255, 255]);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (x % cellPx < 2 || y % cellPx < 2) raw.data.set([128, 128, 128, 255], (y * width + x) * 4);
  const origin = (i) => ({
    x: (i % cols) * cellPx + Math.floor((cellPx - frameW * scale) / 2),
    y: Math.floor(i / cols) * cellPx + Math.floor((cellPx - frameH * scale) / 2),
  });
  frames.forEach((f, i) => {
    if (!f) return;
    const o = origin(i);
    paste(raw, upscale(f, scale), o.x, o.y);
  });
  return { raw, png: await encode(raw), cols, rows, cellPx, scale, frameW, frameH, width, height, origin };
}

/** Decode a model response and resize it back to our canvas size. */
export async function decodeToCanvas(buf, width, height) {
  return resize(await decode(buf), width, height, "lanczos3");
}

export const layoutMeta = (l) => ({
  cols: l.cols, rows: l.rows, cellPx: l.cellPx, scale: l.scale, frameW: l.frameW, frameH: l.frameH,
});
