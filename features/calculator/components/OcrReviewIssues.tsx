"use client";

import { useEffect, useId, useState } from "react";
import type { JobId } from "../domain/types";
import type { OcrBounds, OcrReview, OcrReviewLine } from "../ocr/types";
import { canConfirmReviewText, resolveReviewLine, reviewInputText, reviewQuestions, suggestReviewOptions } from "../ocr/reviewRecognition";

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

export function OcrReviewIssues({ review, job, image, onChange }: { review: OcrReview; job: JobId; image: File; onChange: (review: OcrReview) => void }) {
  const questions = reviewQuestions(review, job);
  return <div className="ocr-review-issues">
    {review.warnings.map((warning, i) => <p key={i} className="ocr-duplicate-message">{warning}</p>)}
    {review.warnings.length > 0 && <label className="check-field"><input type="checkbox" checked={review.imageConfirmed ?? false} onChange={event => onChange({ ...review, imageConfirmed: event.currentTarget.checked })} />원본에서 설명창 전체와 마지막 옵션을 확인했습니다</label>}
    {questions.length > 0 && <p className="ocr-duplicate-message">확인 필요 {questions.length}개</p>}
    {questions.map(line => <Issue key={line.id} line={line} image={image} onResolve={text => onChange(resolveReviewLine(review, line.id, text))} />)}
  </div>;
}
