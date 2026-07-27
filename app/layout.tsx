import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const PRODUCT_METADATA = {
  title: "플래닛 데미지 계산기",
  description:
    "신궁, 캡틴, 나이트로드의 장비 스탯과 환산 공격력을 빠르게 계산합니다.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
} satisfies Metadata;

type HeaderReader = Pick<Headers, "get">;

function firstHeaderValue(value: string | null): string | null {
  const candidate = value?.split(",", 1)[0].trim();
  return candidate || null;
}

function safeHost(value: string | null): string | null {
  const candidate = firstHeaderValue(value);
  if (!candidate || candidate.length > 300) {
    return null;
  }

  for (const character of candidate) {
    const code = character.charCodeAt(0);
    if (
      code <= 0x20 ||
      code === 0x7f ||
      "\\/?#@".includes(character)
    ) {
      return null;
    }
  }

  try {
    const parsed = new URL(`https://${candidate}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }

    return parsed.host || null;
  } catch {
    return null;
  }
}

function isLocalHost(host: string): boolean {
  const hostname = new URL(`http://${host}`).hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

function safeProtocol(value: string | null, host: string): "http" | "https" {
  const protocol = firstHeaderValue(value)?.toLowerCase();
  if (protocol === "http" || protocol === "https") {
    return protocol;
  }

  return isLocalHost(host) ? "http" : "https";
}

export function createMetadata(requestHeaders: HeaderReader): Metadata {
  const host =
    safeHost(requestHeaders.get("x-forwarded-host")) ??
    safeHost(requestHeaders.get("host")) ??
    "localhost";
  const protocol = safeProtocol(
    requestHeaders.get("x-forwarded-proto"),
    host,
  );
  const origin = new URL(`${protocol}://${host}`);
  const imageUrl = new URL("/og.png", origin).toString();

  return {
    ...PRODUCT_METADATA,
    openGraph: {
      type: "website",
      locale: "ko_KR",
      siteName: PRODUCT_METADATA.title,
      title: PRODUCT_METADATA.title,
      description: PRODUCT_METADATA.description,
      url: origin.toString(),
      images: [
        {
          url: imageUrl,
          width: 1536,
          height: 1024,
          alt: PRODUCT_METADATA.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: PRODUCT_METADATA.title,
      description: PRODUCT_METADATA.description,
      images: [
        {
          url: imageUrl,
          alt: PRODUCT_METADATA.title,
        },
      ],
    },
  };
}

export async function generateMetadata(): Promise<Metadata> {
  return createMetadata(await headers());
}

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
