import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), initialize: vi.fn(), predict: vi.fn(), dispose: vi.fn(), prepare: vi.fn() }));
vi.mock("@paddleocr/paddleocr-js", () => ({ PaddleOCR: { create: mocks.create } }));
vi.mock("@/features/calculator/ocr/prepareStatNumbers.client", () => ({ prepareStatNumbers: mocks.prepare, STAT_NUMBER_VIEWS: [{ scale: 3, soft: false }, { scale: 4, soft: true }] }));
import { recognizeStatWindow } from "@/features/calculator/ocr/recognizeStatWindow.client";

const lines = ["직업 캡틴", "레벨 200", "STR 81 (22+59)", "DEX 2306 (1000+1306)", "INT 7 (4+3)", "LUK 7 (4+3)", "공격력 10000~15000", "총데미지 21%", "보스데미지 5%", "방어율무시 10%", "크리확률 0%", "명중률 999"];
const item = (text: string, index: number) => ({ text, score: .99, poly: [[10, 20 + index * 40], [370, 20 + index * 40], [370, 40 + index * 40], [10, 40 + index * 40]] });
const file = () => new File(["private image"], "stat.png", { type: "image/png" });
const recognize = (signal = new AbortController().signal) => recognizeStatWindow(file(), signal, vi.fn());
let broad: (call: number) => string[], focused: (scale: number) => string;

beforeEach(() => {
  vi.resetAllMocks();
  broad = () => lines.map(line => line.startsWith("DEX") ? "DEX 2306 (IO00+1306)" : line);
  focused = () => "2306 (1000+1306)";
  mocks.create.mockResolvedValue({ initialize: mocks.initialize, predict: mocks.predict, dispose: mocks.dispose });
  mocks.initialize.mockResolvedValue(undefined); mocks.dispose.mockResolvedValue(undefined);
  mocks.prepare.mockImplementation(async (_bitmap, regions, view) => ({ file: new File(["numeric pixels"], `stat-numbers-${view.scale}.png`, { type: "image/png" }), width: 400, height: 100, regions: regions.map((region: { label: string }) => ({ label: region.label, bounds: { x: 0, y: .1, width: 1, height: .8 } })) }));
  let call = 0;
  mocks.predict.mockImplementation(async (image: File) => {
    const rowLines = image.name === "stat.png" ? lines : broad(call++);
    const scale = image.name === "stat-window.png" && call === 2 ? 1.5 : 1;
    return [{ items: image.name.startsWith("stat-numbers-") ? [item(focused(image.name.includes("3") ? 3 : 4), 0)] : rowLines.map((text, index) => ({ ...item(text, index), poly: item(text, index).poly.map(point => point.map(number => number * scale)) })) }];
  });
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 1000, height: 1000, close: vi.fn() }));
  vi.spyOn(document, "createElement").mockReturnValue({ width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["pixels"], { type: "image/png" })) } as unknown as HTMLCanvasElement);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("repairs a missing numeric expression with two distinct crops on the same local worker", async () => {
  const result = await recognize();
  expect(result.draft.pure.DEX).toBe(1000); expect(result.draft.total.DEX).toBe(2306);
  expect(result.automatic).toBe(true); expect(result.warnings).toEqual([]);
  expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.predict).toHaveBeenCalledTimes(5);
  expect(mocks.prepare.mock.calls.map(call => call[2].scale)).toEqual([3, 4]);
  expect(mocks.prepare.mock.calls[0][1].map((region: { label: string }) => region.label)).toEqual(["DEX"]);
  expect(mocks.dispose).toHaveBeenCalledTimes(1);
});

it("avoids extra processing for complete original readings", async () => {
  broad = () => lines;
  expect((await recognize()).automatic).toBe(true);
  expect(mocks.predict).toHaveBeenCalledTimes(3); expect(mocks.prepare).not.toHaveBeenCalled();
});

it("does not choose a winner between different numeric crops", async () => {
  focused = scale => scale === 3 ? "2306 (1000+1306)" : "2306 (999+1307)";
  const result = await recognize();
  expect(result.automatic).toBe(false); expect(result.warnings.join(" ")).toContain("두 번");
});

it("does not assign numbers when the field label changes between primary passes", async () => {
  broad = call => lines.map(line => line.startsWith("DEX") ? call === 0 ? "DEX 2306 (IO00+1306)" : "STR 2306 (IO00+1306)" : line);
  const result = await recognize();
  expect(result.automatic).toBe(false); expect(mocks.prepare).not.toHaveBeenCalled();
});

it("cannot erase an original numeric conflict with matching focused reads", async () => {
  broad = call => lines.map(line => line.startsWith("DEX") ? call === 0 ? "DEX 2307 (1000+1307)" : "DEX 2306 (IO00+1306)" : line);
  const result = await recognize();
  expect(result.automatic).toBe(false); expect(result.warnings.join(" ")).toContain("다릅니다");
});

it("does not turn a total alone into pure stats or guess unread letters", async () => {
  focused = scale => scale === 3 ? "2306" : "2306 (Q+2306)";
  const result = await recognize();
  expect(result.draft.pure.DEX).toBeUndefined(); expect(result.automatic).toBe(false);
});

it("preserves the original draft and warnings when numeric preparation fails", async () => {
  mocks.prepare.mockRejectedValue(new Error("Canvas failure"));
  const result = await recognize();
  expect(result.draft.pure.STR).toBe(22); expect(result.draft.pure.DEX).toBeUndefined();
  expect(result.automatic).toBe(false); expect(mocks.dispose).toHaveBeenCalledTimes(1);
});

it("drops a late crop result and disposes the worker once after cancellation", async () => {
  const controller = new AbortController();
  let finish!: (value: unknown) => void;
  let call = 0;
  mocks.predict.mockImplementation(async (image: File) => {
    if (image.name.startsWith("stat-numbers-")) return new Promise(resolve => { finish = resolve; });
    const scale = image.name === "stat-window.png" && call++ === 1 ? 1.5 : 1;
    return [{ items: (image.name === "stat.png" ? lines : broad(0)).map((text, index) => ({ ...item(text, index), poly: item(text, index).poly.map(point => point.map(number => number * scale)) })) }];
  });
  const pending = recognize(controller.signal);
  const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(mocks.predict).toHaveBeenCalledTimes(4));
  controller.abort(); finish([{ items: [item("2306 (1000+1306)", 0)] }]);
  await rejection; expect(mocks.dispose).toHaveBeenCalledTimes(1);
});
