import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decode, crop } from "./image.js";

const DEFAULT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "template");

export class Template {
  constructor(manifest, sheet) {
    this.manifest = manifest;
    this.sheet = sheet;
    this.cell = manifest.cell;
    this.columns = manifest.columns;
    this.groups = manifest.groups;
  }

  static async load(dir = DEFAULT_DIR) {
    const manifest = JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8"));
    const sheet = await decode(await fs.readFile(path.join(dir, "body.png")));
    return new Template(manifest, sheet);
  }

  /** The bare body pixels of one frame (raw RGBA, cell-sized). */
  frame(row, col) {
    const { w, h } = this.cell;
    return crop(this.sheet, col * w, row * h, w, h);
  }

  /** Accepts group names or ids; undefined / "all" means every group. */
  resolveGroups(selectors) {
    if (!selectors || selectors === "all") return this.groups;
    const list = Array.isArray(selectors) ? selectors : [selectors];
    return list.map((s) => {
      const g = this.groups.find((g) => g.name === s || g.id === s);
      if (!g) throw new Error(`Unknown animation "${s}". Available: ${this.groups.map((g) => g.name).join(", ")}`);
      return g;
    });
  }
}
