"use client";

/**
 * 능력창에서 놓친 숫자 셀을 원본에서 추출해 하나의 재판독 이미지로 모은다.
 * 장비 툴팁 전처리와 별개인 보존된 경로이며 숫자 합성/정답 치환은 하지 않는다.
 */

import { statValueStart, type StatNumberRegion } from "./statNumberRegions";

export const STAT_NUMBER_VIEWS = [{ scale: 3, soft: false }, { scale: 4, soft: true }] as const;
export type StatNumberView = { file: File; width: number; height: number; regions: StatNumberRegion[] };

/**
 * 검출 행의 숫자 시작 열부터 잘라 3배 원색/4배 완만한 보정 뷰를 만든다.
 * 최대 12행을 여백과 함께 묶고 새 이미지의 행 좌표를 반환해 결과를 원래 항목에 연결한다. 과도한 면적이나 유효한 행이 없으면 null을 반환한다.
 */
export async function prepareStatNumbers(bitmap: ImageBitmap, regions: StatNumberRegion[], view: typeof STAT_NUMBER_VIEWS[number]): Promise<StatNumberView | null> {
  const rows: Array<{ region: StatNumberRegion; canvas: HTMLCanvasElement }> = [];
  for (const region of regions.slice(0, 12)) {
    const b = region.bounds;
    if (Object.values(b).some(value => !Number.isFinite(value)) || b.x < 0 || b.y < 0 || b.width <= 0 || b.height <= 0 || b.x + b.width > 1.01 || b.y + b.height > 1.01) continue;
    const x = Math.floor(b.x * bitmap.width), y = Math.floor(b.y * bitmap.height);
    const width = Math.min(bitmap.width - x, Math.ceil(b.width * bitmap.width));
    const height = Math.min(bitmap.height - y, Math.ceil(b.height * bitmap.height));
    if (width <= 0 || height <= 0 || width * height * view.scale ** 2 > 1_000_000) continue;
    const raw = document.createElement("canvas"); raw.width = width; raw.height = height;
    const source = raw.getContext("2d", { willReadFrequently: true });
    if (!source) continue;
    source.drawImage(bitmap, x, y, width, height, 0, 0, width, height);
    const start = statValueStart(source.getImageData(0, 0, width, height).data, width, height);
    const canvas = document.createElement("canvas"); canvas.width = (width - start) * view.scale; canvas.height = height * view.scale;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) continue;
    context.imageSmoothingEnabled = false;
    context.drawImage(raw, start, 0, width - start, height, 0, 0, canvas.width, canvas.height);
    if (view.soft) {
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const luminance = .299 * pixels.data[i] + .587 * pixels.data[i + 1] + .114 * pixels.data[i + 2];
        const value = Math.max(0, Math.min(255, (luminance - 40) * 255 / 195));
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
      }
      context.putImageData(pixels, 0, 0);
    }
    rows.push({ region, canvas });
  }
  if (!rows.length) return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(...rows.map(row => row.canvas.width)) + 32;
  canvas.height = rows.reduce((total, row) => total + row.canvas.height + 24, 16);
  if (canvas.width * canvas.height > 2_000_000) return null;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
  const mapped: StatNumberRegion[] = [];
  let top = 16;
  for (const row of rows) {
    context.drawImage(row.canvas, 16, top);
    mapped.push({ label: row.region.label, bounds: { x: 16 / canvas.width, y: top / canvas.height, width: row.canvas.width / canvas.width, height: row.canvas.height / canvas.height } });
    top += row.canvas.height + 24;
  }
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
  return blob ? { file: new File([blob], `stat-numbers-${view.scale}.png`, { type: "image/png" }), width: canvas.width, height: canvas.height, regions: mapped } : null;
}
