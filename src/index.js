import fs from "node:fs/promises";
import path from "node:path";
import { Template } from "./template.js";
import { createGeminiGenerator, withCache, DEFAULT_MODEL } from "./gemini.js";
import { makeDesign, designFromPng, dressSheet } from "./dress.js";
import { makeTileset } from "./tileset.js";

export { createGeminiGenerator, DEFAULT_MODEL } from "./gemini.js";
export { createMockGenerator } from "./mock.js";
export { Template } from "./template.js";

async function save(dir, name, parts) {
  await fs.mkdir(dir, { recursive: true });
  const written = [];
  for (const [suffix, content] of Object.entries(parts)) {
    const file = path.join(dir, `${name}${suffix}`);
    await fs.writeFile(file, content);
    written.push(file);
  }
  return written;
}

export class SpriteForge {
  /**
   * @param {object} o
   * @param {string} [o.apiKey]     Gemini API key (defaults to GEMINI_API_KEY / GOOGLE_API_KEY)
   * @param {string} [o.model]      image model id
   * @param {Function} [o.generator] custom generator (tests, other providers)
   * @param {string|false} [o.cacheDir] disk cache for generations, false to disable
   * @param {string} [o.templateDir] use your own body template (see scripts/build-template.js)
   * @param {string} [o.style]      style notes added to every prompt
   */
  constructor({ apiKey, model, generator, cacheDir = ".spriteforge-cache", templateDir, style } = {}) {
    apiKey ??= process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    model ??= process.env.SPRITEFORGE_MODEL ?? DEFAULT_MODEL;
    if (!generator && !apiKey) throw new Error("spriteforge: pass { apiKey } or set GEMINI_API_KEY");
    this.model = model;
    this.style = style;
    this.templateDir = templateDir;
    this.generate = withCache(generator ?? createGeminiGenerator({ apiKey, model }), cacheDir ? { dir: cacheDir, model } : {});
  }

  async template() {
    return (this._template ??= await Template.load(this.templateDir));
  }

  /** List the animations in the body template. */
  async animations() {
    const t = await this.template();
    return t.groups.map((g) => ({ name: g.name, frames: g.frames, rows: g.rows, rowNames: g.rowNames }));
  }

  /**
   * Step 1 (optional but recommended): preview the outfit on one frame.
   * Pass the result to character() to avoid paying for a design you don't like.
   */
  async design(prompt, opts = {}) {
    const d = await makeDesign({
      template: await this.template(), userPrompt: prompt, generate: this.generate,
      style: opts.style ?? this.style, retries: opts.retries,
    });
    return { ...d, save: (dir, name = "design") => save(dir, name, { ".png": d.png }) };
  }

  /**
   * Generate a dressed character sheet.
   * @param {object} o
   * @param {string} o.prompt              what the character wears / holds
   * @param {string[]} [o.animations]      animation names (default: all)
   * @param {object|Buffer} [o.design]     result of design(), or a cell-sized png
   * @param {Function} [o.onProgress]
   */
  async character({ prompt, animations, design, onProgress, ...opts }) {
    const template = await this.template();
    const groups = template.resolveGroups(animations);
    const full = typeof design === "object" && design?.ref ? design
      : Buffer.isBuffer(design) ? await designFromPng(template, design)
      : await this.design(prompt, opts);
    const stylePrompt = this.style ? `${prompt}. Style notes: ${this.style}` : prompt;
    const r = await dressSheet({ template, groups, userPrompt: stylePrompt, design: full, generate: this.generate, onProgress, ...opts });
    return {
      ...r,
      design: full.png,
      save: (dir, name = "character") => save(dir, name, {
        ".png": r.png, ".json": JSON.stringify(r.atlas, null, 2),
        ".design.png": full.png, ".report.json": JSON.stringify(r.report, null, 2),
      }),
    };
  }

  /**
   * Generate an environment tileset.
   * @param {object} o
   * @param {string} o.prompt   theme, e.g. "modern open-plan office"
   * @param {Array<string|{name, description?, kind?: "tile"|"object", span?: [number, number]}>} o.tiles
   */
  async tileset({ prompt, tiles, tileSize, onProgress, ...opts }) {
    const r = await makeTileset({
      userPrompt: prompt, tiles, tileSize, generate: this.generate, style: opts.style ?? this.style, onProgress, ...opts,
    });
    return {
      ...r,
      save: (dir, name = "tileset") => save(dir, name, {
        ".png": r.png, ".json": JSON.stringify({ image: `${name}.png`, ...r.atlas }, null, 2),
        ".report.json": JSON.stringify(r.report, null, 2),
      }),
    };
  }
}
