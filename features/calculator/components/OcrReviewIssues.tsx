"use client";

/**
 * 현재 직업에 영향을 주는 미해결 판독 줄과 원본 이미지 근거를 연결하는 검토 UI.
 * 제안은 자동 수정이 아니며 사용자 확인/제외와 이미지 잘림 확인을 공통 검토 객체에 반영한다.
 */

import { useEffect, useId, useState } from "react";
import type { JobId } from "../domain/types";
import type { OcrBounds, OcrReview, OcrReviewLine } from "../ocr/types";
import { canConfirmReviewText, resolveReviewLine, reviewInputText, reviewQuestions, suggestReviewOptions } from "../ocr/reviewRecognition";

/**
 * 판독 줄의 상대 좌표로 원본 이미지의 해당 부분을 SVG 뷰포트에 보여준다.
 * 숫자를 그려 넣거나 원본 픽셀을 변경하지 않는다.
 */
function EvidenceLine({ image, bounds }: { image: File; bounds: OcrBounds }) {
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!URL.createObjectURL) return;
    const next = URL.createObjectURL(image);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [image]);
  if (!url) return null;
  const x = Math.max(0, bounds.x - .025) * size.width, y = Math.max(0, bounds.y - .008) * size.height;
  const width = Math.min(1 - x / size.width, bounds.width + .05) * size.width;
  const height = Math.min(1 - y / size.height, bounds.height + .016) * size.height;
  return <div className="ocr-line-evidence">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={url} alt="" hidden onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
    {size.width > 0 && <svg viewBox={`${x} ${y} ${width} ${height}`} role="img" aria-label="해당 옵션의 원본 줄">
      <image href={url} width={size.width} height={size.height} />
    </svg>}
  </div>;
}

/**
 * 한 줄의 원문/표시용 숫자/제안을 보여주고 명시적인 확인 또는 제외를 전달한다.
 */
function Issue({ line, image, onResolve }: { line: OcrReviewLine; image: File; onResolve: (text: string | null) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(() => reviewInputText(line));
  const suggestions = suggestReviewOptions(line);
  return <div className="ocr-review-issue">
    <p>{line.reason}</p>
    {line.bounds && <EvidenceLine image={image} bounds={line.bounds} />}
    {suggestions.length > 0 && <div className="ocr-review-suggestions">

      <div className="equipment-ocr-actions">{suggestions.map(text => <button key={text} type="button" className="secondary-button"
        aria-label={`후보 선택: ${text}`} onClick={() => setDraft(text)}>{text}</button>)}</div>
    </div>}
    <div className="field"><label htmlFor={id}>원본에 보이는 옵션</label>
      <input id={id} value={draft} onChange={event => setDraft(event.currentTarget.value)} placeholder="예: DEX +6%" />
    </div>

    <details><summary>인식 원문</summary><ul>{[...new Set(line.readings.map(reading => reading.text.trim()))].map((text, index) => <li key={index}>{text}</li>)}</ul></details>
    <div className="equipment-ocr-actions">
      <button type="button" className="equipment-ocr-apply" disabled={!canConfirmReviewText(draft)} onClick={() => onResolve(draft)}>이 옵션 확인</button>
      <button type="button" className="secondary-button" onClick={() => onResolve(null)}>이 줄 제외</button>
    </div>
  </div>;
}

/**
 * 직업별 확인 질문과 이미지 경고를 표시하고 변경된 검토 상태를 상위 등록 화면으로 돌려준다.
 */
export function OcrReviewIssues({ review, job, image, onChange }: { review: OcrReview; job: JobId; image: File; onChange: (review: OcrReview) => void }) {
  const questions = reviewQuestions(review, job);
  return <div className="ocr-review-issues">
    {review.warnings.map((warning, i) => <p key={i} className="ocr-duplicate-message">{warning}</p>)}
    {review.warnings.length > 0 && <label className="check-field"><input type="checkbox" checked={review.imageConfirmed ?? false} onChange={event => onChange({ ...review, imageConfirmed: event.currentTarget.checked })} />원본에서 설명창 전체와 마지막 옵션을 확인했습니다</label>}
    {questions.length > 0 && <p className="ocr-duplicate-message">확인 필요 {questions.length}개</p>}
    {questions.map(line => <Issue key={line.id} line={line} image={image} onResolve={text => onChange(resolveReviewLine(review, line.id, text))} />)}
  </div>;
}
