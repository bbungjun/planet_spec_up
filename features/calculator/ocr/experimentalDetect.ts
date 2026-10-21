import type { DetectOptions } from "./detectTooltip";

/** 실험 전용 탐지 옵션의 탭 내부 상태. 제품 경로는 설정하지 않으므로 기본값은 없음이다. */
let options: DetectOptions | undefined;
export function setExperimentalDetectOptions(next: DetectOptions | undefined): void { options = next; }
export function experimentalDetectOptions(): DetectOptions | undefined { return options; }
