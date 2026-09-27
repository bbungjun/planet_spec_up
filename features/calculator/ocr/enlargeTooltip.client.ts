"use client";

/** Preserve pixel-font edges while improving recognition of small tooltips. */
export async function enlargeTooltip(file: File, maximumScale = 2): Promise<File | null> {
  if (typeof createImageBitmap !== "function") return null;
  const bitmap = await createImageBitmap(file);
  try {
    // Large-font captures need less enlargement; tiny captures may need more.
    const preferred = bitmap.width < 400 ? maximumScale : bitmap.width < 800 ? Math.min(2, maximumScale) : 1;
    const scale = Math.min(preferred, Math.sqrt(12_000_000 / (bitmap.width * bitmap.height)));
    if (scale <= 1) return null;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingEnabled = false;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    return blob ? new File([blob], "enlarged-tooltip.png", { type: "image/png" }) : null;
  } finally {
    bitmap.close();
  }
}

export async function tooltipImageSize(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== "function") return null;
  const bitmap = await createImageBitmap(file);
  try { return { width: bitmap.width, height: bitmap.height }; } finally { bitmap.close(); }
}

/** An alternate view for difficult translucent backgrounds. The original is
 * always retained and compared; this view never overwrites the source image. */
export async function contrastTooltip(file: File): Promise<File> {
  if (typeof createImageBitmap !== "function") return file;
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return file;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const white = Math.min(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]);
      const value = 255 - Math.round(Math.max(0, Math.min(1, (white - 135) / 65)) * 255);
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
    }
    context.putImageData(pixels, 0, 0);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    return blob ? new File([blob], "contrast-tooltip.png", { type: "image/png" }) : file;
  } finally { bitmap.close(); }
}
