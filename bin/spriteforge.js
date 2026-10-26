#!/usr/bin/env node
import { parseArgs } from "node:util";
import fs from "node:fs/promises";
import { SpriteForge, createMockGenerator } from "../src/index.js";

const HELP = `spriteforge: prompt in, sprite sheet out

  spriteforge animations
  spriteforge design    "<outfit prompt>"                [--out dir] [--name n]
  spriteforge character "<outfit prompt>"                [--animations a,b] [--design file.png] [--out dir] [--name n]
  spriteforge tileset   "<theme prompt>" --tiles a,b,c   [--tile-size 32] [--out dir] [--name n]

options
  --model <id>     image model (default gemini-2.5-flash-image, or SPRITEFORGE_MODEL)
  --style <text>   extra style notes for every prompt
  --mock           offline test generator: no API key, no cost, placeholder art
  --no-cache       disable the .spriteforge-cache folder

env: GEMINI_API_KEY`;

const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", default: "./assets" }, name: { type: "string" },
    animations: { type: "string" }, design: { type: "string" }, tiles: { type: "string" },
    "tile-size": { type: "string", default: "32" }, model: { type: "string" }, style: { type: "string" },
    mock: { type: "boolean", default: false }, "no-cache": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});
const [cmd, prompt] = positionals;
if (v.help || !cmd) { console.log(HELP); process.exit(v.help ? 0 : 1); }

const forge = new SpriteForge({
  model: v.model, style: v.style,
  apiKey: v.mock ? "mock" : undefined,
  generator: v.mock ? createMockGenerator() : undefined,
  cacheDir: v["no-cache"] || v.mock ? false : ".spriteforge-cache",
});
const list = (s) => s?.split(",").map((x) => x.trim()).filter(Boolean);
const onProgress = (p) => process.stderr.write(`\r${p.stage}: ${p.done}/${p.total} `);
const need = () => { if (!prompt) { console.error("missing prompt\n"); console.log(HELP); process.exit(1); } };

try {
  if (cmd === "animations") {
    for (const a of await forge.animations()) console.log(`${a.name.padEnd(10)} ${a.rows} rows x ${a.frames} frames`);
  } else if (cmd === "design") {
    need();
    const d = await forge.design(prompt);
    console.log((await d.save(v.out, v.name ?? "design")).join("\n"));
  } else if (cmd === "character") {
    need();
    const design = v.design ? await fs.readFile(v.design) : undefined;
    const r = await forge.character({ prompt, animations: list(v.animations), design, onProgress });
    console.error();
    console.log((await r.save(v.out, v.name ?? "character")).join("\n"));
    if (r.report.failed.length) console.error(`warning: ${r.report.failed.length} frames failed validation (see report.json)`);
  } else if (cmd === "tileset") {
    need();
    if (!v.tiles) throw new Error("--tiles is required, e.g. --tiles floor,wall,desk,chair");
    const r = await forge.tileset({ prompt, tiles: list(v.tiles), tileSize: Number(v["tile-size"]), onProgress });
    console.error();
    console.log((await r.save(v.out, v.name ?? "tileset")).join("\n"));
  } else { console.log(HELP); process.exit(1); }
} catch (e) {
  console.error(`\nerror: ${e.message}`);
  process.exit(1);
}
