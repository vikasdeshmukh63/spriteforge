import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { SpriteForge, createMockGenerator, Template } from "../src/index.js";

const forge = (opts) => new SpriteForge({ apiKey: "x", cacheDir: false, generator: createMockGenerator(opts) });

test("template loads as a uniform grid", async () => {
  const t = await Template.load();
  assert.equal(t.groups.length, 14);
  const meta = await sharp(t.sheet.data, { raw: { width: t.sheet.width, height: t.sheet.height, channels: 4 } }).metadata();
  assert.equal(meta.width, t.columns * t.cell.w);
  assert.equal(meta.height, t.manifest.rows * t.cell.h);
});

test("character: dresses selected animations on the template grid", async () => {
  const f = forge();
  const r = await f.character({ prompt: "office worker, blue shirt", animations: ["anim01", "anim04"] });
  assert.equal(r.atlas.rows, 8);                        // 4 + 4 rows
  assert.equal(r.atlas.columns, 7);                     // max(7, 6) frames
  assert.equal(r.atlas.width, 7 * 48);
  const m = await sharp(r.png).metadata();
  assert.deepEqual([m.width, m.height], [7 * 48, 8 * 48]);
  assert.equal(r.report.failed.length, 0, JSON.stringify(r.report.failed.slice(0, 2)));
  assert.equal(r.atlas.animations.anim04.rows[0].row, 4);
});

test("character: a failed generation is retried", async () => {
  const f = forge({ badAttempts: 1 });
  const r = await f.character({ prompt: "x", animations: ["anim07"] });
  assert.ok(r.report.apiCalls >= 2, `expected retries, got ${r.report.apiCalls} calls`);
  assert.equal(r.report.failed.length, 0);
});

test("character: unknown animation gives a helpful error", async () => {
  await assert.rejects(forge().character({ prompt: "x", animations: ["nope"] }), /Unknown animation/);
});

test("tileset: packs tiles and objects with an atlas", async () => {
  const r = await forge().tileset({
    prompt: "modern office", tileSize: 32,
    tiles: ["floor", "wall", "desk", { name: "long desk", span: [2, 1] }, "plant"],
  });
  assert.deepEqual(Object.keys(r.atlas.frames), ["floor", "wall", "desk", "long desk", "plant"]);
  assert.equal(r.atlas.frames["long desk"].w, 64);
  assert.equal(r.report.failed.length, 0);
});
