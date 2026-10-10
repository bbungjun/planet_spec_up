import { expect, it } from "vitest";
import { numericRegion, selectNumericTargets, type PixelPlane } from "../../scripts/ocr-numeric-regions/regions";
import { buildOcrReview } from "../../features/calculator/ocr/reviewRecognition";

function fixture() {
  const p: PixelPlane = { width: 120, height: 30, data: new Uint8ClampedArray(120 * 30 * 4) };
  for (let i = 0; i < p.data.length; i += 4) p.data.set([20, 20, 20, 255], i);
  const rect = (x: number, y: number, w: number, h: number, value = 230) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) p.data.set([value, value, value, 255], (yy * p.width + xx) * 4);
  };
  rect(8, 6, 40, 18); rect(66, 10, 2, 3); rect(66, 18, 2, 3); rect(82, 6, 10, 18);
  return { p, rect };
}
it("extracts the entire value side without tightening around only the bright digits", () => {
  const { p, rect } = fixture(); rect(74, 6, 3, 18, 50); rect(102, 6, 3, 18, 50);
  const result = numericRegion(p);
  expect(result).toMatchObject({ status: "located", region: { x: 69, y: 0, width: 51, height: 30 } });
});
it("declines ambiguous colons rather than selecting one using an expected value", () => {
  const { p, rect } = fixture(); rect(100, 10, 2, 3); rect(100, 18, 2, 3);
  expect(numericRegion(p)).toEqual({ status: "unavailable", reason: "separator-ambiguous-or-missing" });
});
it("declines missing, empty, low-contrast and edge-clipped values", () => {
  const { p, rect } = fixture(); rect(66, 10, 2, 3, 20); rect(66, 18, 2, 3, 20);
  expect(numericRegion(p).status).toBe("unavailable");
  const q = fixture(); q.rect(82, 6, 10, 18, 20); expect(numericRegion(q.p).status).toBe("unavailable");
  const r = fixture(); r.rect(112, 6, 8, 18); expect(numericRegion(r.p)).toEqual({ status: "unavailable", reason: "value-touches-right-edge" });
  const s = fixture(); s.p.data.fill(20); expect(numericRegion(s.p).status).toBe("unavailable");
});
it("selects requirement fields without looking at numeric truth or item names", () => {
  const pair = (text: string, y: number) => [0, 1].map(pass => ({ text, pass, bounds: { x: .4, y, width: .3, height: .03 } }));
  const review = buildOcrReview([...pair("FEQ LE! : Q", .1), ...pair("FIEQ STR : Q", .2), ...pair("장비분류:모자", .5)]);
  expect(selectNumericTargets(review).map(t => t.field)).toEqual(["requiredLevel", "requiredSub"]);
});
