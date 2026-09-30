/**
 * 설명창 분리용 Worker의 메시지 입출력 경계.
 * 파일/지정 영역을 받아 분리된 File과 경고를 돌려주고, 예외는 공통 인식 오류 형식으로 전달한다.
 */
import { prepareTooltipImage } from "./prepareTooltipImage";
import type { OcrBounds } from "./types";

// Worker 안에서만 파일을 처리하고 결과/경고를 호출 탭으로 돌려준다. 서버 업로드 호출은 하지 않는다.
self.onmessage = async (event: MessageEvent<{ file: File; region?: OcrBounds }>) => {
  try {
    let warnings: string[] = [];
    const file = await prepareTooltipImage(event.data.file, event.data.region, result => { warnings = result; });
    self.postMessage({ file, warnings });
  }
  catch (error) { self.postMessage({ error: error && typeof error === "object" && "code" in error ? error : { code: "OCR_FAILED", retryable: true } }); }
};
