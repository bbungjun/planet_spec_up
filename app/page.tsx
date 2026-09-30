import { CalculatorApp } from "@/features/calculator/CalculatorApp";
import { readDevelopmentDefault } from "@/features/calculator/developmentDefault.server";

export default function Page() {
  return <CalculatorApp captainBeta developmentDefault={readDevelopmentDefault()} />;
}
