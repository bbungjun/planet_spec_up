import { describe, expect, it } from "vitest";
import { createSourceFrame, locateSourceRegion, sourceBoundsToPrepared, validSourceFrame, type SourceFrameMetadata } from "@/features/calculator/ocr/sourceFrame";

const metadata = (): SourceFrameMetadata => ({ version: 1, kind: "automatic", inset: 2,
  sourceSize: { width: 1000, height: 700 }, preparedSize: { width: 196, height: 416 },
  crop: { x: 452, y: 182, width: 196, height: 416 } });

describe("original source coordinates", () => {
  it("maps a full prepared frame back to the exact drawn source pixels", () => {
    const frame = metadata();
    const region = locateSourceRegion(frame, { x: 0, y: 0, width: 1, height: 1 })!;
    expect(region.crop).toEqual(frame.crop);expect(region.clipped).toBe(false);
    expect(sourceBoundsToPrepared(frame, region.bounds)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
  it("can read pixels removed by automatic inset without recropping the already trimmed file", () => {
    expect(locateSourceRegion(metadata(), { x: 0, y: 0, width: 1, height: 1 }, 2)?.crop)
      .toEqual({ x: 450, y: 180, width: 200, height: 420 });
  });
  it("reports missing original margins rather than pretending a clipped region is complete", () => {
    const frame: SourceFrameMetadata = { version: 1, kind: "original", inset: 0,
      sourceSize: { width: 320, height: 600 }, preparedSize: { width: 320, height: 600 },
      crop: { x: 0, y: 0, width: 320, height: 600 } };
    expect(locateSourceRegion(frame, { x: 0, y: .2, width: .5, height: .1 }, 2))
      .toMatchObject({ clipped: true, crop: { x: 0, y: 118, width: 162, height: 64 } });
  });
  it("preserves coverage at fractional row edges using floor and ceil", () => {
    expect(locateSourceRegion(metadata(), { x: .1, y: .1, width: .1, height: .1 })?.crop)
      .toEqual({ x: 471, y: 223, width: 21, height: 43 });
  });
  it("retains file references only for the named operation and copies mutable metadata", () => {
    const original = new File(["original"], "original.png"), prepared = new File(["crop"], "crop.png"), meta = metadata();
    const frame = createSourceFrame(original, prepared, meta, { sourceId: "image-1", operationId: "op-1" })!;
    expect(frame.original).toBe(original);expect(frame.prepared).toBe(prepared);
    meta.crop.x = 0;expect(frame.crop.x).toBe(452);
    expect(createSourceFrame(original, prepared, metadata(), { sourceId: "", operationId: "op-1" })).toBeNull();
  });
  it("rejects nonfinite, resized, fractional or out-of-source metadata", () => {
    expect(validSourceFrame({ ...metadata(), preparedSize: { width: 392, height: 832 } })).toBe(false);
    for (const x of [NaN, Infinity, -.1, .2, 900]) {
      expect(locateSourceRegion({ ...metadata(), crop: { ...metadata().crop, x } }, { x: 0, y: 0, width: 1, height: 1 })).toBeNull();
    }
    expect(locateSourceRegion(metadata(), { x: NaN, y: 0, width: 1, height: 1 })).toBeNull();
  });
});
