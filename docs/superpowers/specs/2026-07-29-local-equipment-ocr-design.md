# Local Equipment OCR Design

## Goal

Allow a PC user to choose or paste a MapleStory equipment screenshot into the
selected equipment card, inspect the recognized stat proposal, and explicitly
replace that card's four stat fields. This is browser-local OCR: no OCR API,
server upload, or account is introduced.

## Scope

- Support image files selected with the operating system file picker.
- Support a Windows Print Screen image pasted with Ctrl+V into the focused OCR
  drop zone. A page-level paste enhancement may accept an image only when the
  focus is not an editable text or number input.
- Use a dynamically imported browser OCR worker with Korean and English
  recognition (`kor+eng`), progress reporting, cancellation, and no server
  request.
- Parse flat and percent values for `STR`, `DEX`, `INT`, `LUK`, and
  `올스탯` / `ALL STAT`.
- Map recognized values through the currently selected job's `JOB_RULES`.
- Keep the existing three-job MVP only: Marksman, Corsair, and Night Lord.
- Require an explicit Apply click before changing calculator input.

The feature does not add weapon-potential handling, attack recognition,
database storage, an OCR API key, wiki/chatbot work, or deployment changes.

## User flow

1. The user selects an equipment card and opens its OCR panel.
2. The user either selects a PNG/JPEG/WebP image or focuses the drop zone and
   presses Ctrl+V after Windows Print Screen.
3. The panel validates that the input is an image, copies its `File` before any
   asynchronous work, displays an image preview, and starts local OCR.
4. While recognition runs, the panel exposes a Korean progress status and a
   Cancel action. A later file/paste invalidates the earlier operation.
5. The panel parses OCR text, maps it to the target job, and shows an editable
   proposal for main stat, substat, main-stat percent, and substat percent.
6. The user clicks Apply to replace only those four fields of the selected
   equipment card. Cancel, close, recognition failure, or an empty proposal
   leaves calculator state unchanged.

Images are held only in component memory/object URLs for the active proposal;
the object URL is revoked on replacement, cancellation, and unmount. Images
and OCR text are not persisted in localStorage.

## OCR boundary and data flow

The calculator domain remains unaware of OCR. The OCR feature is split into
small modules:

- `recognizeTooltip.client.ts` is a client-only, dynamically loaded OCR adapter
  that returns raw text and progress. It owns worker lifecycle and does not run
  during SSR/RSC evaluation.
- `parseMapleTooltip.ts` normalizes OCR text and returns raw per-stat flat and
  percent totals. It has no React, browser, or Tesseract dependency.
- `mapRecognizedStats.ts` turns raw totals into job-relative main/sub fields.
- `applyStatReplacement.ts` atomically replaces those four fields while
  preserving the other equipment fields.
- `EquipmentOcrPanel.tsx` owns image ingestion, preview, status, editable
  proposal, and the Apply/Cancel controls.
- `CalculatorApp` owns the one immutable state update for an approved proposal;
  it must not simulate an OCR application as four separate field edits.

The production OCR adapter is injected behind an interface in component tests,
so tests do not start a Worker or WebAssembly runtime.

## Recognition rules

The parser accepts the following logical option lines, tolerating repeated
whitespace, line breaks, and common punctuation noise:

- `STR +10`, `DEX +21`, `INT +7`, `LUK +15`
- `DEX +9%`, `DEX +6%`, `DEX +6%`
- `올스탯 +5`, `올스탯 +3%`, and `ALL STAT +5` variants

Repeated values are summed. Percent and flat values are kept separate.
`올스탯 +n` contributes `n` to both the job main stat and substat. `올스탯
+n%` contributes `n` to both corresponding percent fields. Values for stats
that are neither the current job's main stat nor substat are ignored for this
MVP.

The review panel is deliberately editable. OCR confidence, unknown lines, or
recognized text never mutate the calculator by themselves.

## Application contract

An approved proposal replaces, rather than adds to, the selected slot's values:

| Field | Result after Apply |
| --- | --- |
| `mainFlat` | recognized job-main flat total, or empty when absent |
| `subFlat` | recognized job-sub flat total, or empty when absent |
| `mainPercent` | recognized job-main percent total, or empty when absent |
| `subPercent` | recognized job-sub percent total, or empty when absent |
| `attackFlat`, `attackPercent`, `requiredSub` | preserved exactly |

The target is captured as a `{ job, slot }` snapshot when the image is
ingested. If job or slot changes while OCR is running, the pending job is
cancelled and cannot apply to a different card. The review explicitly names the
captured target.

For the attached sample and a Corsair selected card, the parser/proposal must
produce:

```ts
{
  mainFlat: "21", // DEX +21
  subFlat: "10",  // STR +10
  mainPercent: "21", // DEX +9% +6% +6%
  subPercent: "",
}
```

Applying this proposal clears any old `subPercent` value and preserves the
card's attack and required-substat values.

## Reliability and accessibility

- File input accepts `image/png`, `image/jpeg`, and `image/webp`; unsupported,
  unreadable, or oversized files show an announced error and never start OCR.
- The file input is reset after capture, allowing the same screenshot to be
  selected twice.
- The paste handler claims an event only after an actual image `File` is found;
  normal text pasting into existing inputs remains unchanged.
- Status, errors, cancellation, preview alt text, and proposal controls use
  accessible labels and a polite live region.
- OCR worker startup and recognition occur only in the browser, are serialized,
  and surface progress. The worker is terminated when its panel unmounts.
- The first recognition can download/cached language data in the browser;
  failure to load it reports a retryable error rather than changing equipment.

## Testing and verification

Unit tests cover:

- mixed flat/percent lines, duplicate stat totals, all-stat fan-out, and noisy
  whitespace/punctuation;
- Corsair, Marksman, and Night Lord mapping;
- replacement/clearing semantics and preservation of attack/requirement fields.

Component tests use a mocked recognizer to cover:

- file selection and image paste;
- preview/progress/error/cancel state;
- review-before-apply, editable proposal, and unchanged calculator state before
  Apply;
- the attached-sample text fixture replacing a Corsair card atomically;
- same-file re-selection and stale recognition after slot/job change.

Final verification includes targeted OCR tests, the full unit suite, lint,
typecheck, production build, and a real-browser smoke test that selects the
attached image and pastes a clipboard image into the local site.
