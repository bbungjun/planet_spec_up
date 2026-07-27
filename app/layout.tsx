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

type HostAuthority = {
  authority: string;
  isLocal: boolean;
};

function normalizeHostname(value: string): string | null {
  const hostname = value.toLowerCase();

  if (/^[0-9.]+$/.test(hostname)) {
    const octets = hostname.split(".");
    if (
      octets.length !== 4 ||
      octets.some(
        (octet) =>
          !/^(0|[1-9][0-9]{0,2})$/.test(octet) ||
          Number(octet) > 255,
      )
    ) {
      return null;
    }

    return octets.join(".");
  }

  const hostnameWithoutFinalDot = hostname.endsWith(".")
    ? hostname.slice(0, -1)
    : hostname;
  if (!hostnameWithoutFinalDot || hostnameWithoutFinalDot.length > 253) {
    return null;
  }

  const labels = hostnameWithoutFinalDot.split(".");
  if (
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        !/^[a-z0-9-]+$/.test(label) ||
        label.startsWith("-") ||
        label.endsWith("-"),
    )
  ) {
    return null;
  }

  try {
    if (new URL(`https://${hostname}`).hostname !== hostname) {
      return null;
    }
  } catch {
    return null;
  }

  return hostname;
}

function parseHostAuthority(value: string | null): HostAuthority | null {
  if (!value || value.length > 300) {
    return null;
  }

  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      code <= 0x20 ||
      code === 0x7f ||
      "\\/?#@,".includes(character)
    ) {
      return null;
    }
  }

  let hostname: string;
  let portText: string | undefined;

  if (value.startsWith("[")) {
    const match = /^(\[[0-9a-f:.]+\])(?::([0-9]+))?$/i.exec(value);
    if (!match) {
      return null;
    }

    try {
      hostname = new URL(`http://${match[1]}`).hostname.toLowerCase();
    } catch {
      return null;
    }
    portText = match[2];
  } else {
    const match = /^([^:]+)(?::([0-9]+))?$/.exec(value);
    if (!match) {
      return null;
    }

    const normalizedHostname = normalizeHostname(match[1]);
    if (!normalizedHostname) {
      return null;
    }
    hostname = normalizedHostname;
    portText = match[2];
  }

  let port = "";
  if (portText !== undefined) {
    const portNumber = Number(portText);
    if (
      portText.length > 5 ||
      !Number.isInteger(portNumber) ||
      portNumber < 1 ||
      portNumber > 65535
    ) {
      return null;
    }
    port = `:${portNumber}`;
  }

  return {
    authority: `${hostname}${port}`,
    isLocal:
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]",
  };
}

function requestOrigin(requestHeaders: HeaderReader): URL {
  const host = parseHostAuthority(requestHeaders.get("host")) ?? {
    authority: "localhost",
    isLocal: true,
  };
  const protocol = host.isLocal ? "http" : "https";
  return new URL(`${protocol}://${host.authority}`);
}

export function createMetadata(requestHeaders: HeaderReader): Metadata {
  const origin = requestOrigin(requestHeaders);
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
