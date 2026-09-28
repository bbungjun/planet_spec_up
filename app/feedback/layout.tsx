import type { Metadata } from "next";
import "./feedback.css";

export const metadata: Metadata = {
  title: "오류 제보 | 플래닛 캡틴 계산기",
  description: "익명으로 오류를 제보합니다. 제보 내용은 운영자만 확인할 수 있습니다.",
  robots: { index: false, follow: false },
  alternates: { canonical: null },
  openGraph: { title: "오류 제보 | 플래닛 캡틴 계산기", description: "익명 오류 제보 · 운영자만 조회", url: "/feedback" },
};

export default function FeedbackLayout({ children }: { children: React.ReactNode }) { return children; }
