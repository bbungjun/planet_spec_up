import { notFound } from "next/navigation";
import { CalculatorApp } from "../../features/calculator/CalculatorApp";

export const dynamic = "force-dynamic";

export default function DevelopmentPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <CalculatorApp development />;
}
