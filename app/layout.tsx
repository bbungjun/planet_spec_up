import { headers } from "next/headers";
import { createMetadata } from "@/features/site/metadata";
import { THEME_INIT_SCRIPT } from "@/features/calculator/theme";
import "./globals.css";
// Keep the approved game-inspired presentation after shared component layout rules.
import "./maple-theme.css";

export async function generateMetadata() {
  return createMetadata(await headers());
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} /></head>
      <body>{children}</body>
    </html>
  );
}
