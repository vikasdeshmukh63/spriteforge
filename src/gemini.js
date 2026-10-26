import fs from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI, Modality } from "@google/genai";
import { sha, sleep } from "./util.js";

// Model ids change often: override with the `model` option or SPRITEFORGE_MODEL.
// Image-capable examples: gemini-2.5-flash-image, gemini-3-pro-image-preview.
export const DEFAULT_MODEL = "gemini-2.5-flash-image";

/**
 * A generator is `async ({ prompt, images: Buffer[], salt, meta }) => Buffer(png)`.
 * `meta` is only for mock/test generators; the real one ignores it.
 */
export function createGeminiGenerator({ apiKey, model = DEFAULT_MODEL, maxRetries = 4 }) {
  const ai = new GoogleGenAI({ apiKey });
  return async function generate({ prompt, images = [] }) {
    const parts = [
      ...images.map((b) => ({ inlineData: { mimeType: "image/png", data: b.toString("base64") } })),
      { text: prompt },
    ];
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config: { responseModalities: [Modality.TEXT, Modality.IMAGE] },
        });
        const out = res.candidates?.[0]?.content?.parts ?? [];
        const img = out.find((p) => p.inlineData?.data);
        if (!img) {
          const why = out.map((p) => p.text).filter(Boolean).join(" ") || res.promptFeedback?.blockReason || "no image returned";
          throw Object.assign(new Error(`Gemini returned no image: ${why}`), { noRetry: true });
        }
        return Buffer.from(img.inlineData.data, "base64");
      } catch (err) {
        const status = err.status ?? err.code;
        const transient = [429, 500, 502, 503, 504].includes(Number(status));
        if (err.noRetry || !transient || attempt >= maxRetries) throw err;
        await sleep(1000 * 2 ** attempt);
      }
    }
  };
}

/** Disk cache so identical requests never cost twice. `salt` busts it on retries. */
export function withCache(generate, { dir, model = "" } = {}) {
  if (!dir) return generate;
  return async (req) => {
    const key = sha(model, req.prompt, req.salt ?? "", ...(req.images ?? []));
    const file = path.join(dir, `${key}.png`);
    try { return await fs.readFile(file); } catch { /* miss */ }
    const out = await generate(req);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, out);
    return out;
  };
}
