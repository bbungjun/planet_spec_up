import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "플래닛 데미지 계산기",
  description:
    "신궁, 캡틴, 나이트로드의 장비 스탯과 환산 공격력을 빠르게 계산합니다.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
