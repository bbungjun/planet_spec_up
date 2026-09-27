import { prepareTooltipImage } from "./prepareTooltipImage";
import type { OcrBounds } from "./types";

self.onmessage = async (event: MessageEvent<{ file: File; region?: OcrBounds }>) => {
  try {
    let warnings: string[] = [];
    const file = await prepareTooltipImage(event.data.file, event.data.region, result => { warnings = result; });
    self.postMessage({ file, warnings });
  }
  catch (error) { self.postMessage({ error: error && typeof error === "object" && "code" in error ? error : { code: "OCR_FAILED", retryable: true } }); }
};
