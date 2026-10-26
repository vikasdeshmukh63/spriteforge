import crypto from "node:crypto";

export const sha = (...parts) => {
  const h = crypto.createHash("sha1");
  for (const p of parts) h.update(Buffer.isBuffer(p) ? p : String(p));
  return h.digest("hex");
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run fn over items with at most `limit` in flight; results keep input order. */
export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
