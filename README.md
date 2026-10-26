# spriteforge

Prompt in, game-ready sprite sheet out. Uses Google Gemini image generation.

```js
import { SpriteForge } from "spriteforge-ai";

const forge = new SpriteForge({ apiKey: process.env.GEMINI_API_KEY });

// 1. Preview the outfit on one frame (cheap: 1 call). Optional, but recommended.
const design = await forge.design("office worker, blue shirt, black tie, round glasses, holding a laptop");
await design.save("./assets", "worker-design");

// 2. Dress the whole animation set
const sheet = await forge.character({
  prompt: "office worker, blue shirt, black tie, round glasses, holding a laptop",
  animations: ["idle", "walk"],       // names from forge.animations(); omit for all
  design,                             // reuse the approved look
  onProgress: ({ done, total }) => console.log(`${done}/${total}`),
});
await sheet.save("./assets", "worker");   // worker.png + worker.json (+ design + report)

// 3. Environment tiles
const tiles = await forge.tileset({
  prompt: "modern open-plan office, top-down pixel art",
  tileSize: 32,
  tiles: [
    "floor", "wall",                                    // seamless tiles (auto-detected by name)
    "desk", "chair", "plant", "server rack",            // objects on transparent background
    { name: "long desk", span: [2, 1] },                // objects can span several tiles
    { name: "carpet", kind: "tile" },                   // force a kind explicitly
  ],
});
await tiles.save("./assets", "office");
```

CLI:

```bash
export GEMINI_API_KEY=...
npx spriteforge animations
npx spriteforge design    "office worker, blue shirt, glasses"
npx spriteforge character "office worker, blue shirt, glasses" --animations anim01,anim02 --name worker
npx spriteforge tileset   "modern office" --tiles floor,wall,desk,chair --tile-size 32
npx spriteforge character "test" --mock          # offline, no key, placeholder art
```

## How it works

Image models can't draw a pixel-perfect 350-frame grid in one shot, so the model only draws art and code does the layout.

1. **Template**: `template/body.png` + `manifest.json` is a bare base body on a uniform 48x48 grid (352 frames, 14 animation groups).
2. **Design**: the front frame is dressed once, so you approve the look before spending the full budget.
3. **Dress**: frames are re-laid on a near-square contact sheet (16 per call, 256px cells) with the design as reference; the first approved chunk is passed to the rest so outfits stay identical.
4. **Post-process**: magenta key-out, downscale, hard alpha, k-means palette snap (shared across chunks).
5. **Validate**: each frame's silhouette must cover the template body and keep its feet baseline and centring. Failing chunks are retried; leftovers are listed in `report.failed`.
6. **Pack**: output keeps the template grid, plus a JSON atlas.

A full 14-animation character costs about 23 calls (1 design + 22 chunks, plus retries). Pick fewer animations to spend less.

## Output

`worker.json`:

```json
{
  "cell": { "w": 48, "h": 48 }, "columns": 7, "rows": 8, "width": 336, "height": 384,
  "animations": {
    "idle": { "frames": 7, "fps": 8, "rows": [{ "name": "down", "row": 0, "y": 0, "firstFrame": 0 }] }
  }
}
```

Phaser: `load.spritesheet("worker", "worker.png", { frameWidth: 48, frameHeight: 48 })`, then use
`start: row.firstFrame, end: row.firstFrame + frames - 1`. Any engine: frame (row, col) is at `x = col * 48, y = row * 48`.
`tileset.json` has `frames: { name: { x, y, w, h } }`.

## Name your animations (do this first)

The bundled manifest names groups `anim01...anim14` and rows `row0...row3` because they can't be guessed from pixels. Edit `template/manifest.json`:

```json
{ "id": "anim01", "name": "idle", "rowNames": ["down", "left", "right", "up"] }
```

(`id` stays, `name` and `rowNames` are yours.) To use a different body sheet: `npm run build:template -- path/to/sheet.png`
(rows are detected from transparent gaps, frames from vertical gaps; sheets need transparent backgrounds).

## Options and notes

- `model`: defaults to `gemini-2.5-flash-image`; set `SPRITEFORGE_MODEL` or pass `model` for newer image models. Model ids change, check Google's docs.
- `.spriteforge-cache/` stores every generation (keyed by prompt + images), so reruns are free. Add it to `.gitignore`.
- `retries`, `chunkSize`, `concurrency`, `snap`, `paletteSize`, `validation: { minCoverage, maxBaselineShift, maxCentroidShift }` are all tunable.
- Prompts must not ask for pink/magenta clothing: magenta is the keyed background.
- Generated output is subject to Google's terms and may carry a watermark; check before commercial use. Make sure you have the right to ship whatever body template you bundle.
- Custom providers: pass `generator: async ({ prompt, images, salt, meta }) => pngBuffer`.

## Test

```bash
npm test     # runs offline against a mock generator
```
