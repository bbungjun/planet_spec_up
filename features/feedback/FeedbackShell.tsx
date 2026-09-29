import Link from "next/link";
import { MapleBackdrop, GameIcon } from "@/features/calculator/components/GameVisuals";
import { ThemeToggle } from "@/features/calculator/components/ThemeToggle";

export function FeedbackShell({ admin = false, children }: { admin?: boolean; children: React.ReactNode }) {
  return <main className="feedback-shell">
    <MapleBackdrop />
    <header className="feedback-header">
      <Link className="app-brand" href="/"><span className="brand-symbol"><GameIcon name="leaf" /></span><span>플래닛<span className="brand-secondary">캡틴 전용 베타</span></span></Link>
      <ThemeToggle />
    </header>
    <nav className="feedback-nav" aria-label="오류 제보 메뉴">
      <Link href="/">계산기로</Link>
      <Link href="/feedback" aria-current={!admin ? "page" : undefined}>오류 제보</Link>
      <Link href="/feedback/admin" aria-current={admin ? "page" : undefined}>운영자</Link>
    </nav>
    {children}
    <footer className="feedback-footer">플래닛 캡틴 장비 계산기 · 오류 제보</footer>
  </main>;
}
