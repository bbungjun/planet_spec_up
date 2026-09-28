"use client";

import type { OcrBounds } from "./types";

export const REQUIREMENT_VIEWS = [
  { scale: 3, mode: "gray" }, { scale: 4, mode: "gray" },
  { scale: 3, mode: "soft" }, { scale: 4, mode: "soft" },
] as const;

export const RECOVERY_VIEWS = [
  { scale: 3, mode: "gray" }, { scale: 4, mode: "gray" },
  { scale: 3, mode: "luma" }, { scale: 4, mode: "luma" },
  { scale: 3, mode: "color" }, { scale: 4, mode: "color" },
  { scale: 3, mode: "soft" }, { scale: 4, mode: "soft" },
] as const;
export type RecoveryView = { scale: number; mode: "gray" | "soft" | "luma" | "color" };

/** Preserve small glyph strokes that the whole-tooltip white threshold clips.
 * The crop comes from detected text bounds, never item-specific coordinates. */
export async function requirementView(file: File, bounds: OcrBounds, view: RecoveryView): Promise<File | null> {
  if (typeof createImageBitmap !== "function" || Object.values(bounds).some(value => !Number.isFinite(value))
    || bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0 || bounds.x + bounds.width > 1.01 || bounds.y + bounds.height > 1.01
    || !Number.isFinite(view.scale) || view.scale < 1 || view.scale > 4) return null;
  const bitmap = await createImageBitmap(file);
  try {
    const x = Math.max(0, Math.floor(bounds.x * bitmap.width) - 3), y = Math.max(0, Math.floor(bounds.y * bitmap.height) - 1);
    const width = Math.min(bitmap.width - x, Math.ceil(bounds.width * bitmap.width) + 6);
    const height = Math.min(bitmap.height - y, Math.ceil(bounds.height * bitmap.height) + 2);
    if (width <= 0 || height <= 0 || width * height * view.scale ** 2 > 1_000_000) return null;
    const canvas = document.createElement("canvas");
    canvas.width = width * view.scale + 32; canvas.height = height * view.scale + 32;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.fillStyle = view.mode === "color" ? "#242424" : "white"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(bitmap, x, y, width, height, 16, 16, width * view.scale, height * view.scale);
    const pixels = context.getImageData(16, 16, width * view.scale, height * view.scale);
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (view.mode === "color") continue;
      const white = Math.min(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]);
      const value = view.mode === "luma" ? 255 - Math.round(pixels.data[i] * .299 + pixels.data[i + 1] * .587 + pixels.data[i + 2] * .114)
        : view.mode === "gray" ? 255 - white : 255 - Math.round(Math.max(0, Math.min(1, (white - 60) / 140)) * 255);
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
    }
    context.putImageData(pixels, 16, 16);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    return blob ? new File([blob], `requirement-${view.mode}-${view.scale}.png`, { type: "image/png" }) : null;
  } finally { bitmap.close(); }
}
