import type { Metadata } from "next";
import { CalculatorApp } from "@/features/calculator/CalculatorApp";

const title = "메이플 플래닛 아란 계산기 | 참고 베타";
const description = "아란 STR·DEX·폴암 장비의 최대 스탯공·환산공과 구매 후보를 비교합니다. 폴암 계수와 크리 피해 해석은 참고 모델이며 게임 실측 미검증입니다.";
export const metadata: Metadata = {
  title, description,
  alternates: { canonical: "/aran" },
  openGraph: { title, description, url: "/aran", images: [] },
  twitter: { card: "summary", title, description, images: [] },
};

export default function AranPage() {
  return <CalculatorApp mode="aran" />;
}
