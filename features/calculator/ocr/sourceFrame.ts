import type { OcrBounds } from "./types";

export type ImageSize = { width: number; height: number };
export type PixelRect = { x: number; y: number; width: number; height: number };
/** Serializable preparation result. Coordinates describe the pixels actually drawn, not the requested crop. */
export type SourceFrameMetadata = {
  version: 1;
  sourceSize: ImageSize;
  preparedSize: ImageSize;
  crop: PixelRect;
  kind: "original" | "automatic" | "selected";
  inset: number;
};
/** File references live only for this recognition operation; never persist or clone their contents. */
export type SourceFrame = SourceFrameMetadata & {
  original: File;
  prepared: File;
  sourceId: string;
  operationId: string;
};
export type SourceRegion = { crop: PixelRect; bounds: OcrBounds; clipped: boolean };

const positiveInteger = (n: number) => Number.isSafeInteger(n) && n > 0;
// Normalized coordinates such as .2 + .1 must not add a phantom neighbouring pixel.
const pixelEdge = (n: number) => Math.abs(n - Math.round(n)) < 1e-8 ? Math.round(n) : n;
export function validSourceFrame(frame: SourceFrameMetadata): boolean {
  const { sourceSize: source, preparedSize: prepared, crop } = frame;
  return frame.version === 1 && [source.width, source.height, prepared.width, prepared.height].every(positiveInteger)
    && [crop.x, crop.y, frame.inset].every(n => Number.isSafeInteger(n) && n >= 0)
    && [crop.width, crop.height].every(positiveInteger)
    && crop.x + crop.width <= source.width && crop.y + crop.height <= source.height
    && prepared.width === crop.width && prepared.height === crop.height
    && ["original", "automatic", "selected"].includes(frame.kind);
}

export function createSourceFrame(original: File, prepared: File, metadata: SourceFrameMetadata,
  identity: { sourceId: string; operationId: string }): SourceFrame | null {
  if (!validSourceFrame(metadata) || !identity.sourceId || !identity.operationId) return null;
  return { ...metadata, crop: { ...metadata.crop }, sourceSize: { ...metadata.sourceSize },
    preparedSize: { ...metadata.preparedSize }, original, prepared, ...identity };
}

/** Expand in original pixels, allowing recovery outside the prepared inset without manufacturing missing pixels. */
export function locateSourceRegion(frame: SourceFrameMetadata, bounds: OcrBounds, padding = 0): SourceRegion | null {
  if (!validSourceFrame(frame) || !Object.values(bounds).every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0 || !Number.isFinite(padding) || padding < 0) return null;
  const left = Math.floor(pixelEdge(frame.crop.x + bounds.x * frame.crop.width - padding));
  const top = Math.floor(pixelEdge(frame.crop.y + bounds.y * frame.crop.height - padding));
  const right = Math.ceil(pixelEdge(frame.crop.x + (bounds.x + bounds.width) * frame.crop.width + padding));
  const bottom = Math.ceil(pixelEdge(frame.crop.y + (bounds.y + bounds.height) * frame.crop.height + padding));
  const x = Math.max(0, left), y = Math.max(0, top);
  const width = Math.min(frame.sourceSize.width, right) - x;
  const height = Math.min(frame.sourceSize.height, bottom) - y;
  if (width <= 0 || height <= 0) return null;
  return { crop: { x, y, width, height }, clipped: x !== left || y !== top || x + width !== right || y + height !== bottom,
    bounds: { x: x / frame.sourceSize.width, y: y / frame.sourceSize.height,
      width: width / frame.sourceSize.width, height: height / frame.sourceSize.height } };
}

/** Source-relative OCR polygons return to the same coordinate system as the initial review. */
export function sourceBoundsToPrepared(frame: SourceFrameMetadata, bounds: OcrBounds): OcrBounds | null {
  if (!validSourceFrame(frame) || !Object.values(bounds).every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0) return null;
  return { x: (bounds.x * frame.sourceSize.width - frame.crop.x) / frame.crop.width,
    y: (bounds.y * frame.sourceSize.height - frame.crop.y) / frame.crop.height,
    width: bounds.width * frame.sourceSize.width / frame.crop.width,
    height: bounds.height * frame.sourceSize.height / frame.crop.height };
}
