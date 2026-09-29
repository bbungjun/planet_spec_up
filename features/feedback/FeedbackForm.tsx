"use client";

import { useRef, useState, type FormEvent } from "react";
import { FEEDBACK_CATEGORIES, type FeedbackCategory } from "./types";
import { feedbackRequest, jsonRequest } from "./client";

export function FeedbackForm() {
  const [category, setCategory] = useState<FeedbackCategory>("recognition");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [environment, setEnvironment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const fields = { category, title: title.trim(), description: description.trim(), environment: environment.trim() };
      const fingerprint = JSON.stringify(fields);
      if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, id: crypto.randomUUID() };
      const result = await feedbackRequest<{ id: string }>("/api/feedback", jsonRequest("POST", { ...fields, id: pending.current.id }));
      setReceipt(result.id);
      setTitle(""); setDescription(""); setEnvironment("");
      pending.current = null;
    } catch (error) { setError(error instanceof Error ? error.message : "접수하지 못했습니다. 다시 시도해 주세요."); }
    finally { submitting.current = false; setBusy(false); }
  }

  return <section className="feedback-panel panel" aria-labelledby="feedback-heading">
    <div className="feedback-heading"><span className="feedback-eyebrow">SUPPORT</span><h1 id="feedback-heading">오류 제보</h1><p>로그인 없이 작성할 수 있어요. 내용은 운영자만 확인합니다.</p></div>
    {receipt ? <div className="feedback-receipt" role="status">
      <span className="feedback-receipt-symbol" aria-hidden="true">✓</span>
      <h2>제보가 접수되었습니다</h2>
      <p>운영자가 확인 후 수정에 활용합니다.</p>
      <p className="feedback-ticket">접수 번호 <code>{receipt}</code></p>
      <button className="secondary-button" type="button" onClick={() => { setReceipt(null); setError(null); }}>다른 오류 제보</button>
    </div> : <form className="feedback-form" onSubmit={submit}>
      <fieldset disabled={busy}>
        <label htmlFor="feedback-category">오류 유형</label>
        <select id="feedback-category" value={category} onChange={(event) => setCategory(event.target.value as FeedbackCategory)}>{Object.entries(FEEDBACK_CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <label htmlFor="feedback-title">제목</label>
        <input id="feedback-title" required minLength={5} maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="어떤 오류가 발생했나요?" />
        <label htmlFor="feedback-description">오류 내용 <span>10~4,000자</span></label>
        <textarea id="feedback-description" required minLength={10} maxLength={4000} rows={8} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={"어떤 작업을 했는지, 실제 결과와 기대한 결과를 적어 주세요.\n예: 장갑 사진을 등록했는데 공격력 12가 빈칸으로 표시됩니다."} />
        <label htmlFor="feedback-environment">사용 환경 <span>선택</span></label>
        <input id="feedback-environment" maxLength={200} value={environment} onChange={(event) => setEnvironment(event.target.value)} placeholder="예: PC / Chrome, 아이폰 / Safari" />
      </fieldset>
      <p className="feedback-privacy">장비 사진·세팅은 자동 전송되지 않습니다. 비밀번호·연락처 등 개인정보는 적지 마세요.</p>
      {error && <p className="feedback-error" role="alert">{error}</p>}
      <div className="feedback-form-actions"><span>{description.length.toLocaleString()} / 4,000</span><button className="feedback-primary" type="submit" disabled={busy}>{busy ? "접수 중…" : "제보 보내기"}</button></div>
    </form>}
  </section>;
}
