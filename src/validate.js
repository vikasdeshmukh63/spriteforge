import { alphaBBox } from "./image.js";

/**
 * Does a dressed frame still sit on the template's body?
 * The clothed silhouette must cover the body, keep the feet baseline and
 * stay centred. This is what catches pose drift from the model.
 */
export function compareFrame(body, dressed, opts = {}) {
  const { minCoverage = 0.85, maxBaselineShift = 3, maxCentroidShift = 5, maxAreaRatio = 3.5 } = opts;
  const bb = alphaBBox(body), db = alphaBBox(dressed);
  if (!db) return { ok: false, coverage: 0, reasons: ["empty frame"] };
  // A body pixel counts as covered if the dressed frame has a pixel within 1px:
  // thin limbs lose an edge pixel in every resize round trip.
  const { width: W, height: H } = body;
  const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && dressed.data[(y * W + x) * 4 + 3] > 0;
  let covered = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (body.data[(y * W + x) * 4 + 3] === 0) continue;
      if (on(x, y) || on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) covered++;
    }
  const coverage = bb ? covered / bb.count : 1;
  const baselineShift = bb ? Math.abs(db.y1 - bb.y1) : 0;
  const centroidShift = bb ? Math.abs(db.cx - bb.cx) : 0;
  const areaRatio = bb ? db.count / bb.count : 1;
  const reasons = [];
  if (coverage < minCoverage) reasons.push(`body coverage ${coverage.toFixed(2)}`);
  if (baselineShift > maxBaselineShift) reasons.push(`feet moved ${baselineShift}px`);
  if (centroidShift > maxCentroidShift) reasons.push(`off-centre ${centroidShift.toFixed(1)}px`);
  if (areaRatio > maxAreaRatio) reasons.push(`too large (${areaRatio.toFixed(1)}x body)`);
  return { ok: reasons.length === 0, coverage, baselineShift, centroidShift, reasons };
}
