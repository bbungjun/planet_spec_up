import type { Metadata } from "next";

export const PRODUCT_METADATA = {
  title: "메이플 플래닛 계산기 | 스공 비교",
  description:
    "메이플 플래닛 장비 스크린샷으로 최대 스탯공·환산공과 구매 후보의 가격 대비 효율을 비교합니다. 현재 베타는 캡틴만 지원합니다.",
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

function productionOrigin(): URL | null {
  try {
    const value = new URL(process.env.SITE_URL ?? "");
    if (value.protocol !== "https:" || value.username || value.password || value.pathname !== "/" || value.search || value.hash) return null;
    return value;
  } catch {
    return null;
  }
}

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
  let isLocal: boolean;

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
    isLocal = match[1].toLowerCase() === "[::1]";
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
    isLocal =
      hostname === "localhost" ||
      hostname === "127.0.0.1";
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
    isLocal,
  };
}

function requestOrigin(requestHeaders: HeaderReader): URL | null {
  const host = parseHostAuthority(requestHeaders.get("host"));
  return host?.isLocal
    ? new URL(`http://${host.authority}`)
    : productionOrigin();
}

export function createMetadata(requestHeaders: HeaderReader): Metadata {
  const origin = requestOrigin(requestHeaders);
  const imageUrl = origin ? new URL("/og-captain.png", origin).toString() : undefined;
  const published = process.env.VERCEL_ENV === "production" && productionOrigin() !== null;

  return {
    ...PRODUCT_METADATA,
    robots: { index: published, follow: published },
    ...(published ? { alternates: { canonical: productionOrigin()!.toString() } } : {}),
    openGraph: {
      type: "website",
      locale: "ko_KR",
      siteName: PRODUCT_METADATA.title,
      title: PRODUCT_METADATA.title,
      description: PRODUCT_METADATA.description,
      url: origin?.toString(),
      images: imageUrl ? [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: PRODUCT_METADATA.title,
        },
      ] : [],
    },
    twitter: {
      card: "summary_large_image",
      title: PRODUCT_METADATA.title,
      description: PRODUCT_METADATA.description,
      images: imageUrl ? [
        {
          url: imageUrl,
          alt: PRODUCT_METADATA.title,
        },
      ] : [],
    },
  };
}
