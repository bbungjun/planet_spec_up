"use client";

/** Preserve pixel-font edges while improving recognition of small tooltips. */
export async function enlargeTooltip(file: File): Promise<File | null> {
  if (typeof createImageBitmap !== "function") return null;
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(2, Math.sqrt(12_000_000 / (bitmap.width * bitmap.height)));
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
