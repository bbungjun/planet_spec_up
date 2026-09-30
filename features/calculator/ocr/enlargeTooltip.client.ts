"use client";

/**
 * 작은 설명창의 픽셀 확대와 흰 글자 강조·반전 이미지를 생성한다.
 * 원본 File은 덮어쓰지 않으며, 현재 Paddle 경로는 두 크기에 모두 대비 보정을 적용한다.
 */


/**
 * 설명창 폭에 따라 확대 상한을 정하고 출력 면적을 1,200만 픽셀 기준으로 제한한다.
 * imageSmoothingEnabled=false로 픽셀 경계를 유지한다. 확대가 필요 없거나 지원 기능이 없으면 null을 반환한다.
 */
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

/**
 * 브라우저에서 이미지의 실제 폭·높이를 읽고 디코딩한 비트맵을 즉시 해제한다.
 */
export async function tooltipImageSize(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== "function") return null;
  const bitmap = await createImageBitmap(file);
  try { return { width: bitmap.width, height: bitmap.height }; } finally { bitmap.close(); }
}

/**
 * min(R,G,B)를 135~200 구간에서 대비·반전해 어두운 배경 위의 흰 글자를 강조한다.
 * 135 이하는 흰색, 200 이상은 검은색이 된다. 색상 글자는 사라질 수 있어 원래 색상 이미지도 별도로 보존한다.
 */
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
