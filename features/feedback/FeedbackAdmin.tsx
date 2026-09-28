"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES, type FeedbackList, type FeedbackReport, type FeedbackStatus } from "./types";
import { FeedbackRequestError, feedbackRequest, jsonRequest } from "./client";

function date(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function FeedbackAdmin() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [reports, setReports] = useState<FeedbackReport[]>([]);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const fail = useCallback((error: unknown) => {
    if (error instanceof FeedbackRequestError && error.status === 401) {
      setAuthorized(false); setReports([]); setNextCursor(null);
    }
    setError(error instanceof Error ? error.message : "요청을 완료하지 못했습니다.");
  }, []);

  const load = useCallback(async (filter = "all", query = "", cursor?: number) => {
    const current = ++generation.current;
    setBusy(true); setError(null);
    try {
      const params = new URLSearchParams({ status: filter, search: query });
      if (cursor) params.set("cursor", String(cursor));
      const result = await feedbackRequest<FeedbackList>(`/api/feedback?${params}`);
      if (current !== generation.current) return;
      setAuthorized(true);
      setReports((previous) => cursor ? [...previous, ...result.reports.filter((report) => !previous.some((item) => item.id === report.id))] : result.reports);
      setNextCursor(result.nextCursor);
    } catch (error) {
      if (current === generation.current) {
        // Initial unauthenticated visit is the normal login screen.
        if (error instanceof FeedbackRequestError && error.status === 401) { setAuthorized(false); setReports([]); setNextCursor(null); }
        else fail(error);
      }
    } finally { if (current === generation.current) setBusy(false); }
  }, [fail]);

  useEffect(() => {
    let cancelled = false;
    const requests = generation;
    void Promise.resolve().then(() => { if (!cancelled) return load(); });
    return () => { cancelled = true; requests.current++; };
  }, [load]);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await feedbackRequest("/api/feedback/session", jsonRequest("POST", { password }));
      setPassword("");
      await load(status, appliedSearch);
    } catch (error) { fail(error); }
    finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true); setError(null);
    try {
      await feedbackRequest("/api/feedback/session", { method: "DELETE" });
      generation.current++; setAuthorized(false); setReports([]); setNextCursor(null); setPassword("");
    } catch (error) { fail(error); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="admin-heading" className="feedback-admin">
    <div className="feedback-admin-heading"><div><span className="feedback-eyebrow">SUPPORT DESK</span><h1 id="admin-heading">제보 관리</h1><p>익명 제보를 확인하고 수정 진행 상황을 기록합니다.</p></div>{authorized && <button className="secondary-button" type="button" disabled={busy} onClick={signOut}>로그아웃</button>}</div>
    {authorized === null ? <div className="feedback-panel panel" role="status">{busy ? "접근 권한 확인 중…" : "접근 권한을 확인하지 못했습니다."}{error && <p role="alert" className="feedback-error">{error}</p>}{!busy && <button type="button" className="secondary-button" onClick={() => void load(status, appliedSearch)}>다시 시도</button>}</div> : !authorized ? <form className="feedback-login feedback-panel panel" onSubmit={signIn}>
      <h2>운영자 로그인</h2><label htmlFor="admin-password">운영자 비밀번호</label><input id="admin-password" type="password" autoComplete="current-password" required maxLength={256} value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} />
      {error && <p role="alert" className="feedback-error">{error}</p>}
      <button className="feedback-primary" type="submit" disabled={busy}>{busy ? "확인 중…" : "로그인"}</button>
    </form> : <>
      <form className="feedback-filters panel" onSubmit={(event) => { event.preventDefault(); setAppliedSearch(search.trim()); void load(status, search.trim()); }}>
        <label htmlFor="admin-status-filter">처리 상태<select id="admin-status-filter" disabled={busy} value={status} onChange={(event) => { setStatus(event.target.value); void load(event.target.value, appliedSearch); }}><option value="all">전체</option>{Object.entries(FEEDBACK_STATUSES).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label htmlFor="admin-search">제보 검색<input type="search" id="admin-search" placeholder="제목·내용·메모" maxLength={100} value={search} disabled={busy} onChange={(event) => setSearch(event.target.value)} /></label>
        <button className="secondary-button" type="submit" disabled={busy}>검색</button><button className="secondary-button" type="button" disabled={busy} onClick={() => void load(status, appliedSearch)}>새로고침</button>
      </form>
      {error && <p className="feedback-error" role="alert">{error}</p>}
      {busy && <p className="feedback-loading" role="status">제보 불러오는 중…</p>}
      {!reports.length && !busy && !error && <div className="feedback-empty panel">{status === "all" && !appliedSearch ? "아직 접수된 제보가 없습니다." : "조회 조건에 맞는 제보가 없습니다."}</div>}
      <div className="feedback-report-list">{reports.map((report) => <ReportCard key={report.id} report={report} disabled={busy} onFailure={fail} onUpdated={(updated) => { setReports((previous) => previous.map((item) => item.id === updated.id ? updated : item)); }} onDeleted={() => setReports((previous) => previous.filter((item) => item.id !== report.id))} />)}</div>
      {nextCursor !== null && <button className="feedback-load-more secondary-button" type="button" disabled={busy} onClick={() => void load(status, appliedSearch, nextCursor)}>이전 제보 더 보기</button>}
    </>}
  </section>;
}

function ReportCard({ report, disabled, onUpdated, onDeleted, onFailure }: { report: FeedbackReport; disabled: boolean; onUpdated: (report: FeedbackReport) => void; onDeleted: () => void; onFailure: (error: unknown) => void }) {
  const [status, setStatus] = useState<FeedbackStatus>(report.status);
  const [note, setNote] = useState(report.adminNote);
  const [editVersion, setEditVersion] = useState(report.updatedAt);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changed = status !== report.status || note !== report.adminNote;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage(null); setError(null);
    try {
      const result = await feedbackRequest<{ report: FeedbackReport }>(`/api/feedback/${report.id}`, jsonRequest("PATCH", { status, adminNote: note, updatedAt: editVersion }));
      onUpdated(result.report); setStatus(result.report.status); setNote(result.report.adminNote); setEditVersion(result.report.updatedAt); setMessage("처리 상태와 메모를 저장했습니다.");
    } catch (error) { setError(error instanceof Error ? error.message : "저장하지 못했습니다."); if (error instanceof FeedbackRequestError && error.status === 401) onFailure(error); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!window.confirm(`“${report.title}” 제보를 삭제할까요? 삭제 후 복구할 수 없습니다.`)) return;
    setBusy(true); setMessage(null); setError(null);
    try { await feedbackRequest(`/api/feedback/${report.id}`, jsonRequest("DELETE", { updatedAt: report.updatedAt })); onDeleted(); }
    catch (error) { setError(error instanceof Error ? error.message : "삭제하지 못했습니다."); if (error instanceof FeedbackRequestError && error.status === 401) onFailure(error); }
    finally { setBusy(false); }
  }

  return <article className="feedback-report panel" aria-labelledby={`report-${report.id}`}>
    <div className="feedback-report-meta"><span className={`feedback-badge status-${report.status}`}>{FEEDBACK_STATUSES[report.status]}</span><span>{FEEDBACK_CATEGORIES[report.category]} · 익명</span><time dateTime={report.createdAt}>{date(report.createdAt)} KST</time></div>
    <h2 id={`report-${report.id}`}>{report.title}</h2>
    <p className="feedback-report-description">{report.description}</p>
    {report.environment && <p className="feedback-report-environment"><strong>사용 환경</strong> {report.environment}</p>}
    <details className="feedback-management">
      <summary>처리 상태·운영자 메모</summary>
      <form onSubmit={save}>
        {editVersion !== report.updatedAt && <div className="feedback-error" role="alert">서버의 제보가 변경됐습니다. 작성 중인 메모를 확인한 뒤 최신 내용을 불러오세요. <button type="button" className="secondary-button" disabled={busy || disabled} onClick={() => { setStatus(report.status); setNote(report.adminNote); setEditVersion(report.updatedAt); setError(null); setMessage(null); }}>최신 내용 불러오기</button></div>}
        <label htmlFor={`status-${report.id}`}>처리 상태<select id={`status-${report.id}`} value={status} disabled={busy || disabled} onChange={(event) => { setStatus(event.target.value as FeedbackStatus); setMessage(null); }}>{Object.entries(FEEDBACK_STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label htmlFor={`note-${report.id}`}>운영자 메모<textarea id={`note-${report.id}`} maxLength={4000} rows={3} disabled={busy || disabled} value={note} onChange={(event) => { setNote(event.target.value); setMessage(null); }} placeholder="원인·수정 내용·관련 커밋 등을 기록하세요." /></label>
        {message && <p role="status" className="feedback-success">{message}</p>}{error && <p role="alert" className="feedback-error">{error}</p>}
        <div className="feedback-management-actions"><button type="submit" className="feedback-primary" disabled={busy || disabled || !changed}>{busy ? "처리 중…" : "변경 저장"}</button><button type="button" className="secondary-button feedback-delete" disabled={busy || disabled} onClick={remove}>제보 삭제</button></div>
      </form>
    </details>
    <p className="feedback-report-id">접수 번호 {report.id} · 최근 변경 {date(report.updatedAt)} KST</p>
  </article>;
}
