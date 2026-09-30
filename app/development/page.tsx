import { notFound } from "next/navigation";
import { CalculatorApp } from "../../features/calculator/CalculatorApp";
import { readDevelopmentDefault } from "../../features/calculator/developmentDefault.server";

export const dynamic = "force-dynamic";

export default async function DevelopmentPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <CalculatorApp development developmentDefault={await readDevelopmentDefault()} />;
}
