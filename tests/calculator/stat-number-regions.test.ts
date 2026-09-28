import { expect, it } from "vitest";
import { parseStatWindow, reconcileStatReads } from "@/features/calculator/ocr/parseStatWindow";
import { sameStatNumberRow, statNumberMissing, statNumberRegions, statNumberRows, statNumberText, statValueStart } from "@/features/calculator/ocr/statNumberRegions";
import type { OcrReading } from "@/features/calculator/ocr/types";

const reading = (text: string, x: number, y = .1, width = .1): OcrReading => ({ text, pass: 0, bounds: { x, y, width, height: .03 } });

it("follows detected field positions and keeps the entire total/base/bonus expression", () => {
  const rows = [reading("DEX", .1, .2, .04), reading("2306 (1000+1306)", .15, .201, .22), reading("공격력", .6, .2), reading("10000 ~ 15000", .71, .2, .2)];
  const regions = statNumberRegions(rows);
  expect(regions.map(region => region.label)).toEqual(["DEX", "공격력"]);
  expect(regions[0].bounds.x + regions[0].bounds.width).toBeGreaterThan(.37);
  expect(regions[0].bounds.x + regions[0].bounds.width).toBeLessThan(.4);
  const moved = statNumberRegions(rows.map(row => ({ ...row, bounds: { ...row.bounds!, x: row.bounds!.x + .02, y: row.bounds!.y + .1 } })));
  expect(moved[0].bounds.x - regions[0].bounds.x).toBeCloseTo(.02);
  expect(moved[0].bounds.y - regions[0].bounds.y).toBeCloseTo(.1);
});

it("uses pixel aspect ratio for nearby values and excludes adjacent columns and other baselines", () => {
  const regions = statNumberRegions([reading("DEX", .1, .2, .03), reading("2306 (1000+1306)", .14, .2, .15), reading("999", .34, .2), reading("888", .14, .4)], 2);
  expect(regions[0].bounds.x + regions[0].bounds.width).toBeLessThan(.30);
  expect(statNumberRegions([reading("DEX", .1), { ...reading("STR", .1), bounds: { x: NaN, y: .1, width: .1, height: .1 } }])).toHaveLength(1);
  expect(statNumberRegions([reading("DEX", .1)], 0)).toEqual([]);
});

it("does not derive positions from unrecognized labels or move already parsed fields into retry", () => {
  expect(statNumberRegions([reading("DEXTER", .1), reading("장비 DEX +5", .1), reading("크리데미지", .1)])).toEqual([]);
  const complete = parseStatWindow(["DEX 2306 (1000+1306)", "공격력 10000~15000", "크리확률 0%"]).draft;
  expect(statNumberMissing("DEX", complete)).toBe(false);
  expect(statNumberMissing("STR", complete)).toBe(true);
  expect(statNumberMissing("공격력", complete)).toBe(false);
  expect(statNumberMissing("크리확률", complete)).toBe(false);
});

it("crosses a colored label cell gap but requires the field identity and position to agree", () => {
  const first = statNumberRegions([reading("DEX", .1, .2, .03), reading("2306 (1000+1306)", .19, .2, .2)], 2)[0];
  expect(first.bounds.x + first.bounds.width).toBeGreaterThan(.39);
  expect(sameStatNumberRow(first, { ...first, label: "STR" })).toBe(false);
  expect(sameStatNumberRow(first, { ...first, bounds: { ...first.bounds, x: .7 } })).toBe(false);
  expect(sameStatNumberRow(first, { ...first, bounds: { ...first.bounds, width: .04 } })).toBe(true);
});

it("finds a light value cell without clipping red digits or requiring a specific label color", () => {
  const width = 120, height = 20, pixels = new Uint8ClampedArray(width * height * 4);
  pixels.fill(255);
  for (let y = 0; y < height; y++) for (let x = 0; x < 35; x++) pixels.set([150, 60, 100, 255], (y * width + x) * 4);
  for (let y = 4; y < 16; y++) for (let x = 45; x < 48; x++) pixels.set([255, 0, 0, 255], (y * width + x) * 4);
  expect(statValueStart(pixels, width, height)).toBe(33);
  expect(statValueStart(new Uint8ClampedArray(width * height * 4).fill(255), width, height)).toBe(0);
  expect(statValueStart(new Uint8ClampedArray(1), width, height)).toBe(0);
  expect(statValueStart(pixels.slice(0, 0), 0, height)).toBe(0);
});

it.each(["IO00(4+996)", "2306 (Q+2306)", "", "STR 2306(1000+1306)"])("does not repair unread digits or attach a different field: %s", text => {
  expect(statNumberText("DEX", text)).toBeNull();
});

it("preserves numeric syntax, percentages and zero rather than adding missing units or pure stats", () => {
  expect(statNumberText("DEX", "２,３０６ (１０００ + １３０６)")).toBe("DEX 2306(1000+1306)");
  expect(statNumberText("공격력", "10,000 ~ 15,000")).toBe("공격력 10000~15000");
  expect(statNumberText("크리확률", "0%")).toBe("크리확률 0%");
  expect(statNumberText("크리확률", "0")).toBe("크리확률 0");
  const draft = parseStatWindow([statNumberText("DEX", "2306")!, statNumberText("크리확률", "0")!]).draft;
  expect(draft.pure.DEX).toBeUndefined(); expect(draft.criticalRate).toBeUndefined();
});

it("maps only readings inside their numeric row and retains conflicting primary evidence", () => {
  const regions = [{ label: "DEX" as const, bounds: { x: 0, y: .2, width: 1, height: .1 } }];
  const focused = statNumberRows([reading("2306", .1, .22), reading("(1000+1306)", .3, .22), reading("888", .1, .6)], regions);
  expect(focused).toEqual(["DEX 2306(1000+1306)"]);
  const original = parseStatWindow(["DEX 2307 (1000+1307)", ...focused]);
  expect(original.warnings.join(" ")).toContain("다릅니다");
  expect(reconcileStatReads(original, original).automatic).toBe(false);
});
