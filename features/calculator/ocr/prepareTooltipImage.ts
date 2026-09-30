/**
 * 설명창 탐지 또는 사용자가 지정한 영역으로 원본 스크린샷을 분리한다.
 * 색상·원래 픽셀을 유지한 PNG가 이후 미리보기와 확대/재인식의 기준 이미지가 된다.
 */
import { detectTooltipRegions, selectTooltipRegion } from "./detectTooltip";
import type { OcrBounds } from "./types";

/**
 * 이미지 면적을 제한하고, 넓은 캡처에는 자동 탐지, 지정 영역에는 좌표 검증 후 자르기를 수행한다.
 * 작은 캡처는 그대로 사용한다. 후보가 모호하거나 영역이 너무 작으면 오류를 반환하고, 사진 끝에 닿은 영역은 잘림 경고를 전달한다.
 */
export async function prepareTooltipImage(file: File, region?: OcrBounds, onWarnings?: (warnings: string[]) => void): Promise<File> {
  if (typeof createImageBitmap !== "function") return file;
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 24_000_000) throw { code: "IMAGE_DIMENSIONS_TOO_LARGE", retryable: false };
    // 큰 가로 화면만 자동 탐지한다. 작은 설명창 캡처의 픽셀은 불필요하게 다시 자르지 않는다.
    const broad = bitmap.width >= 700 && bitmap.width > bitmap.height * 1.2;
    if (!region && !broad) return file;
    const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(bitmap.width, bitmap.height) : document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!context) throw new Error("Canvas unavailable");
    let rect;
    if (region) {
      if (Object.values(region).some(value => !Number.isFinite(value)) || region.width <= 0 || region.height <= 0 || region.x < 0 || region.y < 0 || region.x + region.width > 1.001 || region.y + region.height > 1.001) throw { code: "INVALID_CROP", retryable: false };
      rect = { x: Math.round(region.x * bitmap.width), y: Math.round(region.y * bitmap.height), width: Math.round(region.width * bitmap.width), height: Math.round(region.height * bitmap.height) };
    } else {
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const candidates = detectTooltipRegions(pixels);
      rect = selectTooltipRegion(pixels, candidates);
      if (!rect) throw { code: candidates.length ? "MULTIPLE_TOOLTIPS" : "TOOLTIP_NOT_FOUND", retryable: false,
        regions: candidates.slice(0, 4).map(candidate => ({ x: candidate.x / bitmap.width, y: candidate.y / bitmap.height, width: candidate.width / bitmap.width, height: candidate.height / bitmap.height })) };
      // 자동 검출 프레임의 테두리만 안쪽으로 줄인다. 사용자 지정 영역에는 같은 inset을 적용하지 않는다.
      const inset = Math.max(2, Math.round(rect.width * .01));
      rect = { x: rect.x + inset, y: rect.y + inset, width: rect.width - inset * 2, height: rect.height - inset * 2 };
    }
    rect.width = Math.min(rect.width, bitmap.width - rect.x);
    rect.height = Math.min(rect.height, bitmap.height - rect.y);
    if (rect.width < 30 || rect.height < 30) throw { code: "INVALID_CROP", retryable: false };
    if (rect.y + rect.height >= bitmap.height - 5 || rect.x + rect.width >= bitmap.width - 5) onWarnings?.(["설명창이 사진 끝에 닿아 있어요. 마지막 옵션이 잘리지 않았는지 확인해주세요."]);
    canvas.width = rect.width; canvas.height = rect.height;
    context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    const blob = "convertToBlob" in canvas ? await canvas.convertToBlob({ type: "image/png" })
      : await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Tooltip crop failed");
    return new File([blob], "isolated-tooltip.png", { type: "image/png" });
  } finally { bitmap.close(); }
}
