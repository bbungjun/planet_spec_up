import { afterEach, describe, expect, it, vi } from "vitest";
import { detectTooltipRegions, selectTooltipRegion, type TooltipRect } from "@/features/calculator/ocr/detectTooltip";
import { prepareTooltip } from "@/features/calculator/ocr/prepareTooltip.client";

function screenshot(width = 1000, height = 700) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([95, 110, 90, 255], i);
  const set = (x: number, y: number, color: number[]) => data.set([...color, 255], (y * width + x) * 4);
  const frame = (rect: TooltipRect, color = [225, 185, 20], light = false) => {
    for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) {
      const border = x === rect.x || y === rect.y || x === rect.x + rect.width - 1 || y === rect.y + rect.height - 1;
      set(x, y, border ? color : light ? [220, 220, 220] : [55, 45, 80]);
    }
  };
  return { data, width, height, frame, set };
}

describe("tooltip frame detection", () => {
  it("does not select a small bright quick-slot control beside a larger tooltip", () => {
    const pixels = screenshot();
    const tooltip = { x: 100, y: 100, width: 250, height: 480 };
    const control = { x: 700, y: 500, width: 100, height: 100 };
    pixels.frame(tooltip);
    pixels.frame(control);
    for (let y = 520; y < 550; y++) for (let x = 715; x < 745; x++) pixels.set(x, y, [240, 240, 240]);
    expect(selectTooltipRegion(pixels, [tooltip, control])).toEqual(tooltip);
  });

  it("keeps a short tooltip when its width is comparable to the neighboring panel", () => {
    const pixels = screenshot();
    const short = { x: 80, y: 80, width: 220, height: 225 };
    const tall = { x: 420, y: 80, width: 250, height: 480 };
    pixels.frame(short);
    pixels.frame(tall);
    expect(selectTooltipRegion(pixels, [short, tall])).toBeNull();
    expect(selectTooltipRegion(pixels, [short])).toEqual(short);
  });

  it.each([
    [{ x: 450, y: 180, width: 200, height: 420 }, [225, 185, 20]],
    [{ x: 80, y: 35, width: 160, height: 340 }, [190, 70, 210]],
    [{ x: 640, y: 150, width: 280, height: 480 }, [30, 190, 220]],
  ] as const)("finds frames at different positions, sizes and colors", (rect, color) => {
    const pixels = screenshot();
    pixels.frame(rect, [...color]);
    expect(detectTooltipRegions(pixels)).toEqual([rect]);
  });

  it("tolerates a cursor covering part of one side without trimming the top options", () => {
    const pixels = screenshot();
    const rect = { x: 450, y: 100, width: 200, height: 500 };
    pixels.frame(rect);
    for (let y = 200; y < 250; y++) pixels.set(450, y, [255, 255, 255]);
    expect(detectTooltipRegions(pixels)).toEqual([rect]);
  });

  it("finds a short, dark gray tooltip at a different position", () => {
    const pixels = screenshot(1200, 800);
    pixels.frame({ x: 650, y: 250, width: 240, height: 245 }, [30, 35, 50]);
    const found = detectTooltipRegions(pixels);
    expect(found).toHaveLength(1);
    expect(Math.abs(found[0].x - 650)).toBeLessThan(5);
    expect(Math.abs(found[0].height - 245)).toBeLessThan(8);
  });

  it("keeps separate tooltips separate instead of joining two items' options", () => {
    const pixels = screenshot();
    pixels.frame({ x: 80, y: 35, width: 200, height: 430 });
    pixels.frame({ x: 450, y: 180, width: 180, height: 390 });
    expect(detectTooltipRegions(pixels)).toHaveLength(2);
  });

  it("keeps two adjacent panes separate even when an enclosing border is visible", () => {
    const pixels = screenshot();
    pixels.frame({ x: 100, y: 100, width: 450, height: 450 });
    pixels.frame({ x: 100, y: 100, width: 220, height: 450 });
    pixels.frame({ x: 330, y: 100, width: 220, height: 450 });
    const regions = detectTooltipRegions(pixels);
    expect(regions.length).toBeGreaterThanOrEqual(2);
    expect(regions.every(region => region.width < 300)).toBe(true);
  });

  it("rejects scenery and bright windows, and recovers interrupted borders from contrast", () => {
    const pixels = screenshot();
    expect(detectTooltipRegions(pixels)).toEqual([]);
    pixels.frame({ x: 80, y: 35, width: 200, height: 430 }, undefined, true);
    expect(detectTooltipRegions(pixels)).toEqual([]);
    pixels.frame({ x: 80, y: 35, width: 200, height: 430 });
    for (let x = 80; x < 280; x++) pixels.set(x, 35, [95, 110, 90]);
    const regions = detectTooltipRegions(pixels);
    expect(regions).toHaveLength(1);
    expect(Math.abs(regions[0].width - 200)).toBeLessThan(6);
  });
});

describe("browser-local tooltip preparation", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  function browser(pixels: ReturnType<typeof screenshot>) {
    const bitmap = { width: pixels.width, height: pixels.height, close: vi.fn() };
    const context = { drawImage: vi.fn(), getImageData: vi.fn().mockReturnValue(pixels) };
    const canvas = { width: 0, height: 0, getContext: vi.fn().mockReturnValue(context), toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["local crop"])) };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    vi.spyOn(document, "createElement").mockReturnValue(canvas as unknown as HTMLCanvasElement);
    return { bitmap, canvas, context };
  }

  const file = () => new File(["private capture"], "desktop.png", { type: "image/png" });

  it("crops one detected frame before OCR and releases its decoded bitmap", async () => {
    const pixels = screenshot();
    pixels.frame({ x: 450, y: 180, width: 200, height: 420 });
    const { bitmap, canvas, context } = browser(pixels);
    const prepared = await prepareTooltip(file());
    expect(prepared.name).toBe("isolated-tooltip.png");
    expect(canvas).toMatchObject({ width: 196, height: 416 });
    expect(context.drawImage).toHaveBeenLastCalledWith(bitmap, 452, 182, 196, 416, 0, 0, 196, 416);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("preserves a tight portrait capture without cropping its actual options", async () => {
    const { bitmap, context } = browser(screenshot(320, 600));
    const original = file();
    expect(await prepareTooltip(original)).toBe(original);
    expect(context.getImageData).not.toHaveBeenCalled();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("reports worker loading failure separately and retries with the same photo", async () => {
    type StubWorker = { onerror?: () => void; onmessage?: (event: { data: { file: File } }) => void; terminate: ReturnType<typeof vi.fn> };
    const workers: StubWorker[] = [];
    vi.stubGlobal("OffscreenCanvas", class {});
    vi.stubGlobal("Worker", class {
      onerror?: () => void;
      onmessage?: (event: { data: { file: File } }) => void;
      terminate = vi.fn();
      constructor() { workers.push(this); }
      postMessage() {}
    });
    const original = file();
    const failed = prepareTooltip(original);
    const failure = expect(failed).rejects.toEqual({ code: "OCR_UNAVAILABLE", retryable: true });
    workers[0].onerror?.();await failure;
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    const retry = prepareTooltip(original);
    workers[1].onmessage?.({ data: { file: original } });
    expect(await retry).toBe(original);expect(workers[1].terminate).toHaveBeenCalledTimes(1);
  });

  it("uses a user-selected normalized region and rejects selections outside the source", async () => {
    const { bitmap, context } = browser(screenshot());
    await prepareTooltip(file(), { region: { x: .2, y: .1, width: .3, height: .6 } });
    expect(context.drawImage).toHaveBeenLastCalledWith(bitmap, 200, 70, 300, 420, 0, 0, 300, 420);
    await expect(prepareTooltip(file(), { region: { x: .9, y: .1, width: .3, height: .6 } })).rejects.toMatchObject({ code: "INVALID_CROP" });
  });

  it("explains a missing or ambiguous frame instead of reading chat and desktop text", async () => {
    const pixels = screenshot();
    const { bitmap } = browser(pixels);
    await expect(prepareTooltip(file())).rejects.toMatchObject({ code: "TOOLTIP_NOT_FOUND" });
    pixels.frame({ x: 80, y: 35, width: 200, height: 430 });
    pixels.frame({ x: 450, y: 180, width: 180, height: 390 });
    await expect(prepareTooltip(file())).rejects.toMatchObject({ code: "MULTIPLE_TOOLTIPS" });
    expect(bitmap.close).toHaveBeenCalledTimes(2);
  });
});
