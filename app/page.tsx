import { CalculatorApp } from "@/features/calculator/CalculatorApp";
import { readDevelopmentDefault } from "@/features/calculator/developmentDefault.server";

export default async function Page() {
  return <CalculatorApp captainBeta developmentDefault={await readDevelopmentDefault()} />;
}
