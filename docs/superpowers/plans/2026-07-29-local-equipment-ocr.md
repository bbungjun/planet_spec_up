# Local Equipment OCR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a PC user select or paste a MapleStory item screenshot, review locally recognized stats, and atomically replace the selected equipment card's four stat fields.

**Architecture:** Keep OCR independent from calculator math. Pure modules parse raw OCR text, map stats through `JOB_RULES`, and produce a replacement object; a client-only Tesseract adapter supplies raw text to an `EquipmentOcrPanel`; `CalculatorApp` is the sole owner of the approved immutable equipment update.

**Tech Stack:** React 19, TypeScript 5.9, vinext/Vite, Vitest 4, Testing Library, Tesseract.js 7.0.0 browser worker, browser File/Clipboard APIs.

## Global Constraints

- Keep the three-job MVP and existing calculation formulas unchanged.
- Process screenshot OCR entirely in the browser; no API key, server upload, database, or persisted image/OCR text.
- Support file-picker images (`image/png`, `image/jpeg`, `image/webp`) and Windows Print Screen image paste with Ctrl+V.
- Never mutate equipment until the user explicitly presses Apply.
- OCR values replace `mainFlat`, `subFlat`, `mainPercent`, and `subPercent`; preserve `attackFlat`, `attackPercent`, and `requiredSub` exactly.
- Parse `STR`, `DEX`, `INT`, `LUK`, and `올스탯`/`ALL STAT`; all-stat contributes to both current-job main and sub stats.
- The attached-tooltip Corsair case must yield `mainFlat: "21"`, `subFlat: "10"`, `mainPercent: "21"`, `subPercent: ""`.
- TDD is mandatory: every production behavior begins with a focused failing test.
- Implementers are Luna; each task gets a Sol xhigh peer review and any Critical/Important finding is fixed and re-reviewed before the next task.
- Preserve the pre-existing untracked `.omo/` directory.

## Planned File Structure

```text
features/calculator/
  ocr/
    types.ts                         # OCR-neutral contracts and replacement shape
    parseMapleTooltip.ts             # pure OCR text normalization and stat summation
    mapRecognizedStats.ts            # raw stat totals -> current-job proposal
    applyStatReplacement.ts          # immutable four-field replacement
    recognizeTooltip.client.ts       # dynamic browser-only Tesseract worker adapter
  components/
    EquipmentOcrPanel.tsx            # picker/paste/progress/review/apply interaction
    EquipmentEditor.tsx              # hosts the OCR panel below card fields
  CalculatorApp.tsx                  # guarded, atomic approved-OCR state update
app/globals.css                      # OCR panel states and responsive layout
tests/calculator/
  ocr-parser.test.ts                 # parser, mapping, and replacement unit tests
  equipment-ocr-panel.test.tsx       # mocked recognizer file/paste/review states
  calculator-app.test.tsx            # card-level atomic application integration test
package.json                          # pin tesseract.js runtime dependency
package-lock.json
```

---

### Task 1: Freeze the OCR domain contract and pure replacement behavior

**Files:**
- Create: `features/calculator/ocr/types.ts`
- Create: `features/calculator/ocr/parseMapleTooltip.ts`
- Create: `features/calculator/ocr/mapRecognizedStats.ts`
- Create: `features/calculator/ocr/applyStatReplacement.ts`
- Create: `tests/calculator/ocr-parser.test.ts`

**Interfaces:**
- Consumes: `JOB_RULES`, `JobId`, and `EquipmentInput` from the existing calculator domain.
- Produces: `parseMapleTooltip(text)`, `mapRecognizedStats(parsed, job)`, and `applyStatReplacement(equipment, replacement)`.
- Consumers: Tasks 3 and 4.

- [ ] **Step 1: Write failing unit tests for the attached-tooltip fixture and all-stat fan-out**

Create `tests/calculator/ocr-parser.test.ts` with imports from the three new
modules. Assert this exact sequence:

```ts
const attachedTooltipText = [
  "STR +10",
  "DEX +21",
  "HP +15",
  "DEX +9%",
  "DEX +6%",
  "DEX +6%",
].join("\n");

expect(mapRecognizedStats(parseMapleTooltip(attachedTooltipText), "corsair"))
  .toEqual({
    mainFlat: "21",
    subFlat: "10",
    mainPercent: "21",
    subPercent: "",
  });

expect(mapRecognizedStats(
  parseMapleTooltip("올스탯 +5\nALL STAT +3%\nLUK +7%"),
  "night_lord",
)).toEqual({
  mainFlat: "5",
  subFlat: "5",
  mainPercent: "10",
  subPercent: "3",
});
```

Add tests that duplicate/noisy `DEX : + 6 %` lines sum only their matching
stat and that a sentinel `EquipmentInput` keeps its three non-stat fields
after replacement while an absent substat-percent becomes `""`.

- [ ] **Step 2: Run the parser test and verify RED**

Run:

```powershell
npm run test:unit -- tests/calculator/ocr-parser.test.ts
```

Expected: FAIL because the OCR modules do not exist.

- [ ] **Step 3: Define OCR-only types without changing calculator domain types**

Create `features/calculator/ocr/types.ts`:

```ts
import type { EquipmentInput, JobId } from "../domain/types";

export const OCR_STAT_NAMES = ["STR", "DEX", "INT", "LUK"] as const;
export type OcrStatName = (typeof OCR_STAT_NAMES)[number];
export type StatTotals = { flat: number; percent: number };
export type ParsedTooltipStats = {
  stats: Record<OcrStatName, StatTotals>;
  allStat: StatTotals;
};
export type StatReplacement = Pick<
  EquipmentInput,
  "mainFlat" | "subFlat" | "mainPercent" | "subPercent"
>;
export type OcrTarget = { job: JobId; slot: import("../domain/types").EquipmentSlot };
```

- [ ] **Step 4: Implement the minimal parser, mapper, and immutable replacement**

`parseMapleTooltip.ts` must uppercase Latin text, normalize OCR punctuation and
whitespace, recognize `ALL STAT` and Korean `올스탯`, then add each matching
`+number` value into `flat` or `percent`. It must initialize every stat to
`{ flat: 0, percent: 0 }` and ignore unrelated lines.

`mapRecognizedStats.ts` must read `JOB_RULES[job].mainStat` and `.subStat`, add
the parsed `allStat` total to both matching values, and convert zero totals to
empty strings.

`applyStatReplacement.ts` must return:

```ts
return { ...equipment, ...replacement };
```

No function may mutate its input.

- [ ] **Step 5: Run the focused test and the existing equipment tests**

Run:

```powershell
npm run test:unit -- tests/calculator/ocr-parser.test.ts tests/calculator/equipment.test.ts
```

Expected: PASS with the attached fixture, all-stat mapping, replacement, and
existing equipment behavior covered.

- [ ] **Step 6: Commit the pure OCR contract**

```powershell
git add features/calculator/ocr tests/calculator/ocr-parser.test.ts
git commit -m "feat: add OCR stat parsing and replacement"
```

---

### Task 2: Add a lazy, cancellable browser OCR adapter

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `features/calculator/ocr/recognizeTooltip.client.ts`
- Create: `tests/calculator/recognize-tooltip.test.ts`

**Interfaces:**
- Consumes: `File`, `AbortSignal`, and `ParsedTooltipStats` consumers from Task 1.
- Produces: `TooltipRecognizer`, `TooltipRecognitionProgress`, and `createBrowserTooltipRecognizer()`.
- Consumers: Task 3.

- [ ] **Step 1: Add tests for recognizer contract helpers before browser runtime code**

Write `tests/calculator/recognize-tooltip.test.ts` against exported helpers:

```ts
expect(isSupportedTooltipImage(new File(["x"], "item.png", { type: "image/png" }))).toBe(true);
expect(isSupportedTooltipImage(new File(["x"], "item.gif", { type: "image/gif" }))).toBe(false);
expect(toRecognitionError(new DOMException("Cancelled", "AbortError")))
  .toEqual({ code: "CANCELLED", retryable: false });
```

Include a test that a file over the exported `MAX_TOOLTIP_IMAGE_BYTES` is
rejected before recognition starts.

- [ ] **Step 2: Run the adapter test and verify RED**

Run:

```powershell
npm run test:unit -- tests/calculator/recognize-tooltip.test.ts
```

Expected: FAIL because the adapter module does not exist.

- [ ] **Step 3: Install the pinned browser OCR runtime**

Run:

```powershell
npm install tesseract.js@7.0.0
```

Keep it in `dependencies`, not `devDependencies`.

- [ ] **Step 4: Implement the client-only recognizer contract**

Create `recognizeTooltip.client.ts` beginning with `"use client";` and export:

```ts
export type TooltipRecognitionProgress = {
  status: "loading" | "recognizing";
  progress: number;
};
export type TooltipRecognizer = {
  recognize(file: File, options: {
    signal: AbortSignal;
    onProgress: (progress: TooltipRecognitionProgress) => void;
  }): Promise<string>;
  terminate(): Promise<void>;
};
```

Implement `createBrowserTooltipRecognizer()` with a lazy `await import("tesseract.js")` inside `recognize`, a single reused worker, and:

```ts
const worker = await createWorker(["kor", "eng"], 1, { logger });
const { data: { text } } = await worker.recognize(file);
```

Translate worker logger events to the two public progress statuses. Check
`signal.aborted` before startup and before returning text. On cancellation,
terminate the worker and reject with an `AbortError`; a later recognition
creates a fresh worker. `terminate()` must be idempotent and clear its worker
reference. Do not reference `window`, `Worker`, or instantiate OCR at module
top-level.

Export pure `isSupportedTooltipImage`, `MAX_TOOLTIP_IMAGE_BYTES` (12 MiB), and
`toRecognitionError` helpers used by the tests and UI.

- [ ] **Step 5: Run adapter tests, typecheck, and production build**

Run:

```powershell
npm run test:unit -- tests/calculator/recognize-tooltip.test.ts
npm run typecheck
npm run build
```

Expected: all commands exit 0; the build proves importing card UI does not
eagerly instantiate a browser-only worker.

- [ ] **Step 6: Commit the OCR adapter**

```powershell
git add package.json package-lock.json features/calculator/ocr/recognizeTooltip.client.ts tests/calculator/recognize-tooltip.test.ts
git commit -m "feat: add local browser OCR adapter"
```

---

### Task 3: Build the file-picker and Ctrl+V OCR review panel

**Files:**
- Create: `features/calculator/components/EquipmentOcrPanel.tsx`
- Create: `tests/calculator/equipment-ocr-panel.test.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: Task 1 parser/mapper/types and Task 2 `TooltipRecognizer` contract.
- Produces: `EquipmentOcrPanel` with `target`, `onApply`, and optional
  `createRecognizer` test seam.
- Consumers: Task 4.

- [ ] **Step 1: Write failing interaction tests with an injected recognizer**

Create a fake recognizer that resolves the attached-tooltip text. Write tests
that render `EquipmentOcrPanel` with target `{ job: "corsair", slot: "overall" }`
and verify:

1. Uploading `new File(["screenshot"], "overall.png", { type: "image/png" })`
   invokes recognition and shows DEX 21, STR 10, and DEX% 21 in editable fields.
2. Before clicking Apply, `onApply` has not been called; after click it receives
   the captured target and the exact four-field replacement.
3. A `paste` event carrying an `image/png` `File` starts recognition and calls
   `preventDefault`; a paste with only `text/plain` does neither.
4. Cancel aborts the pending job and does not call Apply; a stale first promise
   cannot overwrite the second selected image's proposal.
5. Unsupported MIME and oversized images render an announced error.

- [ ] **Step 2: Run the panel test and verify RED**

Run:

```powershell
npm run test:unit -- tests/calculator/equipment-ocr-panel.test.tsx
```

Expected: FAIL because the panel does not exist.

- [ ] **Step 3: Implement image ingestion and proposal review**

Implement `EquipmentOcrPanel` with:

- a visually styled `<input type="file" accept="image/png,image/jpeg,image/webp">`
  and accessible selection button;
- a focusable paste zone (`tabIndex={0}`) named `장비 스크린샷 붙여넣기`;
- synchronous extraction from `event.clipboardData.items` / `.files` before
  awaiting OCR, and `preventDefault()` only after an image file is claimed;
- file input reset after capture;
- an object URL image preview that is revoked for every completed/cancelled/
  superseded job and on unmount;
- `AbortController` plus monotonically increasing operation ID, preventing stale
  results from setting state;
- `aria-live="polite"` progress/status, visible Cancel, retryable errors, and
  four editable review values;
- explicit Apply and Cancel buttons. Apply passes `OcrTarget` and
  `StatReplacement` upward; it never writes calculator state itself.

Use a default `createBrowserTooltipRecognizer` factory while allowing the test
to inject a fake recognizer. When target props change, cancel and clear any
pending proposal so an old slot/job cannot receive a result.

- [ ] **Step 4: Add compact OCR styling**

Append scoped `.equipment-ocr-*` rules to `app/globals.css`: separate the
upload controls, preview, status, proposal inputs, and danger/cancel action;
keep controls at least 44px tall, preserve dark-theme contrast, and collapse
proposal fields to one column below 760px.

- [ ] **Step 5: Run focused panel tests and lint**

Run:

```powershell
npm run test:unit -- tests/calculator/equipment-ocr-panel.test.tsx
npm run lint
```

Expected: PASS with upload, paste, stale-job, cancellation, review, and error
paths covered.

- [ ] **Step 6: Commit the standalone panel**

```powershell
git add features/calculator/components/EquipmentOcrPanel.tsx app/globals.css tests/calculator/equipment-ocr-panel.test.tsx
git commit -m "feat: add equipment screenshot OCR review panel"
```

---

### Task 4: Integrate approved OCR replacement into card editing

**Files:**
- Modify: `features/calculator/components/EquipmentEditor.tsx`
- Modify: `features/calculator/CalculatorApp.tsx`
- Modify: `tests/calculator/calculator-app.test.tsx`

**Interfaces:**
- Consumes: `EquipmentOcrPanel`, `OcrTarget`, `StatReplacement`, and
  `applyStatReplacement`.
- Produces: card-level OCR UI that atomically updates only the active slot.
- Consumers: final QA.

- [ ] **Step 1: Write a failing calculator integration test**

In `tests/calculator/calculator-app.test.tsx`, mock the browser recognizer to
return the attached-tooltip text. Render the existing page, select the Corsair
`한벌옷` card, prefill `한벌옷 DEX` with `99`, `한벌옷 STR%` with `88`,
`한벌옷 공격력` with `123`, `한벌옷 공격력%` with `9`, and
`한벌옷 요구 STR` with `45`, then upload the supplied mock PNG through the
OCR file input. Assert:

```ts
expect(screen.getByLabelText("한벌옷 DEX")).toHaveValue(99);
// before Apply: all original values remain visible
await user.click(screen.getByRole("button", { name: "인식값 적용" }));
expect(screen.getByLabelText("한벌옷 DEX")).toHaveValue(21);
expect(screen.getByLabelText("한벌옷 STR")).toHaveValue(10);
expect(screen.getByLabelText("한벌옷 DEX%")).toHaveValue(21);
expect(screen.getByLabelText("한벌옷 STR%")).toHaveValue(null);
expect(screen.getByLabelText("한벌옷 공격력")).toHaveValue(123);
expect(screen.getByLabelText("한벌옷 요구 STR")).toHaveValue(45);
```

Use the actual Korean card labels already supplied by the component rather than
adding duplicate test-only labels. Also verify a second equipment card stays
unchanged.

- [ ] **Step 2: Run the integration test and verify RED**

Run:

```powershell
npm run test:unit -- tests/calculator/calculator-app.test.tsx
```

Expected: FAIL because the card editor does not expose OCR application.

- [ ] **Step 3: Wire the OCR panel and atomic state update**

Extend `EquipmentEditor` props with an OCR-apply callback and render
`EquipmentOcrPanel` beneath its existing field grid for card mode only.

In `CalculatorApp`, add one handler that accepts `(target: OcrTarget,
replacement: StatReplacement)`. It must use a single `setInput(current => …)`
callback, return `current` when `current.character.job !== target.job` or the
captured slot is absent, and otherwise use `applyStatReplacement` only for
`target.slot`. This is the only state-changing OCR path.

- [ ] **Step 4: Run the integration and keyboard/bulk regression tests**

Run:

```powershell
npm run test:unit -- tests/calculator/calculator-app.test.tsx tests/calculator/keyboard-flow.test.tsx tests/calculator/bulk-editor.test.tsx
```

Expected: PASS; card OCR updates the shared state so bulk mode reflects it,
while keyboard navigation behavior remains unchanged.

- [ ] **Step 5: Commit integration**

```powershell
git add features/calculator/CalculatorApp.tsx features/calculator/components/EquipmentEditor.tsx tests/calculator/calculator-app.test.tsx
git commit -m "feat: apply OCR stats to selected equipment"
```

---

### Task 5: Verify the real screenshot flow and complete the quality gates

**Files:**
- Modify only if a verified defect is found in Tasks 1–4.
- Test: all OCR tests, full suite, lint, typecheck, build, and local browser.

**Interfaces:**
- Consumes: completed Tasks 1–4 and user-provided screenshot at
  `C:\Users\PC\AppData\Local\Temp\codex-clipboard-6ff72091-8619-4ef5-b34e-6ec187550e70.png`.
- Produces: evidence that local file upload and Ctrl+V both deliver reviewable,
  correctly applied equipment replacements.

- [ ] **Step 1: Run the complete automated verification set**

Run:

```powershell
npm test
npm run lint
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 2: Start the local app and perform a file-picker smoke test**

Run the existing local development command, open `http://localhost:3000/`,
select Corsair and an equipment card, upload the user-provided PNG, and verify
the review shows DEX 21 / STR 10 / DEX% 21 before Apply. Apply it and inspect
the four card fields plus preserved attack/requirement values.

- [ ] **Step 3: Perform the Windows-style clipboard smoke test**

Copy the same image to the system clipboard, focus `장비 스크린샷 붙여넣기`,
press Ctrl+V, and verify that it reaches the same review state. Cancel it and
verify no field changes; repeat then Apply and verify replacement.

- [ ] **Step 4: Resolve every Critical or Important review finding**

Run a final Sol xhigh whole-branch review against the starting SHA for this
plan. For each Critical/Important finding, write a regression test first,
apply the minimal fix, rerun the affected test, and request a scoped Sol
re-review. Record a reason for every deferred Minor finding.

- [ ] **Step 5: Commit any review fixes and record verification evidence**

```powershell
git status --short
git log --oneline --max-count=10
```

Only commit files that belong to the OCR feature; leave `.omo/` untouched.
