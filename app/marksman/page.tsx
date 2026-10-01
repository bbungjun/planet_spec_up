import type { Metadata } from "next";
import { CalculatorApp } from "@/features/calculator/CalculatorApp";

const title = "메이플 플래닛 신궁 계산기 | 스공 비교";
const description = "신궁 DEX·STR·석궁 장비의 최대 스탯공·환산공과 구매 후보를 비교합니다. 엑스퍼트·샤프 아이즈는 마스터 기준이며 게임 실측 검증은 미완료입니다.";
export const metadata: Metadata = {
  title, description,
  alternates: { canonical: "/marksman" },
  openGraph: { title, description, url: "/marksman", images: [] },
  twitter: { card: "summary", title, description, images: [] },
};

export default function MarksmanPage() {
  return <CalculatorApp mode="marksman" />;
}
