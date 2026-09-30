"use client";

/**
 * 원래 설명창의 작은 행 영역에서 부분 재인식용 이미지를 만든다.
 * 기본 재시도는 gray/luma/color/soft × 3/4배, 실험 원본 검증은 color/luma × 2/3배로 구분한다.
 */

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

export const VERIFICATION_VIEWS = [
  { scale: 2, mode: "color" }, { scale: 3, mode: "color" },
  { scale: 2, mode: "luma" }, { scale: 3, mode: "luma" },
] as const;
export type RequirementVerificationView = {
  file: File;
  width: number;
  height: number;
  crop: OcrBounds;
  contentWidth: number;
  contentHeight: number;
  padding: number;
};

/**
 * 실험 검증기가 지정한 원본 영역을 확대하고 사방 16px의 인공 여백을 추가한다.
 * 잘라낼 영역을 임의로 넓히거나 자르지 않는다. 픽셀에 맞춘 실제 crop·출력 크기·여백을 함께 반환해 원본 좌표 환산에 사용한다.
 */
export async function requirementVerificationView(file: File, crop: OcrBounds, view: typeof VERIFICATION_VIEWS[number]): Promise<RequirementVerificationView | null> {
  if (typeof createImageBitmap !== "function" || Object.values(crop).some(value => !Number.isFinite(value))
    || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1 || crop.y + crop.height > 1) return null;
  const bitmap = await createImageBitmap(file);
  try {
    const x = Math.round(crop.x * bitmap.width), y = Math.round(crop.y * bitmap.height);
    const width = Math.round(crop.width * bitmap.width), height = Math.round(crop.height * bitmap.height);
    if (width <= 0 || height <= 0 || x + width > bitmap.width || y + height > bitmap.height || width * height * view.scale ** 2 > 1_000_000) return null;
    const canvas = document.createElement("canvas"), padding = 16;
    canvas.width = width * view.scale + padding * 2; canvas.height = height * view.scale + padding * 2;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.fillStyle = view.mode === "color" ? "#242424" : "white"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(bitmap, x, y, width, height, padding, padding, width * view.scale, height * view.scale);
    if (view.mode === "luma") {
      const pixels = context.getImageData(padding, padding, width * view.scale, height * view.scale);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const value = 255 - Math.round(pixels.data[i] * .299 + pixels.data[i + 1] * .587 + pixels.data[i + 2] * .114);
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
      }
      context.putImageData(pixels, padding, padding);
    }
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    return blob ? { file: new File([blob], `verified-requirement-${view.mode}-${view.scale}.png`, { type: "image/png" }),
      width: canvas.width, height: canvas.height, contentWidth: width * view.scale, contentHeight: height * view.scale, padding,
      crop: { x: x / bitmap.width, y: y / bitmap.height, width: width / bitmap.width, height: height / bitmap.height } } : null;
  } finally { bitmap.close(); }
}

/**
 * 검출한 행의 주변 여유를 포함해 원본에서 다시 자르고 확대·변환 후 16px 여백을 추가한다.
 * 변환별 색상 보존/채널 최솟값 반전/휘도 반전/완만한 대비를 적용한다. 유효하지 않은 영역이나 과도한 면적은 null로 건너뛴다.
 */
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
