// Offline generator for tests, demos and `--mock`: no API key, no cost.
// It "dresses" the template's body pixels with flat colours so you can check
// layout, validation, packing and atlas output end to end.
import sharp from "sharp";
import { decode, encode, blank } from "./image.js";

const isBg = (d, i) => Math.abs(d[i] - 255) + d[i + 1] + Math.abs(d[i + 2] - 255) < 90;

export function createMockGenerator({ badAttempts = 0, shrink = 0.8 } = {}) {
  const calls = [];
  const fn = async ({ images, meta, salt = "" }) => {
    calls.push({ kind: meta.kind, salt });
    const { cols, rows, cellPx, scale, frameW, frameH } = meta;
    let canvas;
    if (meta.kind === "tiles") {
      canvas = await decode(images[images.length - 1]);
      meta.specs.forEach((s, i) => {
        const ox = (i % cols) * cellPx + 8, oy = Math.floor(i / cols) * cellPx + 8;
        const hue = [(i * 53) % 200 + 40, (i * 97) % 200 + 40, (i * 31) % 200 + 40];
        const [x0, y0, x1, y1] = s.kind === "tile" ? [0, 0, cellPx - 16, cellPx - 16] : [60, 40, cellPx - 76, cellPx - 30];
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const o = ((oy + y) * canvas.width + ox + x) * 4;
          const checker = s.kind === "tile" && ((x >> 5) + (y >> 5)) % 2;
          canvas.data.set([hue[0] - (checker ? 20 : 0), hue[1], hue[2], 255], o);
        }
      });
    } else if ((badAttempts && calls.filter((c) => c.kind === meta.kind).length <= badAttempts)) {
      canvas = blank(cols * cellPx, rows * cellPx, [255, 0, 255, 255]); // a failed generation
    } else {
      canvas = await decode(images[0]);
      const d = canvas.data, W = canvas.width;
      const cells = cols * rows;
      for (let i = 0; i < cells; i++) {
        const ox = (i % cols) * cellPx + Math.floor((cellPx - frameW * scale) / 2);
        const oy = Math.floor(i / cols) * cellPx + Math.floor((cellPx - frameH * scale) / 2);
        let y0 = Infinity, y1 = -1;
        for (let y = 0; y < frameH * scale; y++) for (let x = 0; x < frameW * scale; x++) {
          const p = ((oy + y) * W + ox + x) * 4;
          if (!isBg(d, p)) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        }
        if (y1 < 0) continue;
        const h = y1 - y0;
        for (let y = y0; y <= y1; y++) for (let x = 0; x < frameW * scale; x++) {
          const p = ((oy + y) * W + ox + x) * 4;
          if (isBg(d, p)) continue;
          const t = (y - y0) / h;
          const c = t < 0.16 ? [90, 50, 20] : t > 0.45 && t < 0.62 ? [40, 90, 200] : t >= 0.62 && t < 0.93 ? [50, 50, 70] : null;
          if (c) d.set(c, p);
        }
      }
    }
    const png = await encode(canvas);
    return sharp(png).resize(Math.round(canvas.width * shrink), Math.round(canvas.height * shrink)).png().toBuffer();
  };
  fn.calls = calls;
  return fn;
}
