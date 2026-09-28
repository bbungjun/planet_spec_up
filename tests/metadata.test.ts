import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMetadata } from "@/features/site/metadata";

const title = "플래닛 캡틴 장비 계산기 | 베타";
const description =
  "캡틴 전용 베타. 장비 스크린샷으로 세팅을 등록하고 최대 스탯공·환산공과 구매 후보의 가격 대비 효율을 비교합니다.";
const canonicalOrigin =
  "https://planet.example.com/";
const canonicalImage =
  "https://planet.example.com/og-captain.png";

beforeEach(() => { vi.stubEnv("SITE_URL", canonicalOrigin); vi.stubEnv("VERCEL_ENV", "production"); });
afterEach(() => vi.unstubAllEnvs());

describe("social metadata", () => {
  it("omits obsolete domains and indexing before a production URL is confirmed", () => {
    vi.stubEnv("SITE_URL", "");
    const metadata = createMetadata(new Headers({host: "preview.vercel.app"}));
    expect(metadata.robots).toEqual({index: false, follow: false});
    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph).toMatchObject({url: undefined, images: []});
    expect(JSON.stringify(metadata)).not.toContain("chatgpt.site");
  });

  it("keeps Vercel previews out of search even when SITE_URL is configured", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const metadata = createMetadata(new Headers({host: "preview.vercel.app"}));
    expect(metadata.robots).toEqual({index: false, follow: false});
    expect(metadata.alternates).toBeUndefined();
  });

  it("uses only the configured production URL for canonical metadata", () => {
    expect(createMetadata(new Headers({host: "evil.example"})).alternates).toEqual({canonical: canonicalOrigin});
  });
  function expectCanonicalUrls(metadata: ReturnType<typeof createMetadata>) {
    expect(metadata.openGraph).toMatchObject({
      url: canonicalOrigin,
      images: [{ url: canonicalImage }],
    });
    expect(metadata.twitter).toMatchObject({
      images: [{ url: canonicalImage }],
    });
  }

  it("uses the canonical production origin despite direct and forwarded spoofing", () => {
    const metadata = createMetadata(new Headers({
      "host": "evil.example:8443",
      "x-forwarded-host": "forwarded-evil.example:8080",
      "x-forwarded-proto": "http",
    }));

    expect(metadata).toMatchObject({
      title,
      description,
      openGraph: {
        type: "website",
        locale: "ko_KR",
        siteName: title,
        title,
        description,
        url: canonicalOrigin,
        images: [{
          url: canonicalImage,
          width: 1200,
          height: 630,
          alt: title,
        }],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [{
          url: canonicalImage,
          alt: title,
        }],
      },
    });
    expect(JSON.stringify(metadata)).not.toContain("evil.example");
    expect(JSON.stringify(metadata)).not.toContain("http://");
  });

  it("normalizes the exact canonical Host to the canonical production origin", () => {
    const metadata = createMetadata(new Headers({
      "host": "planet-damage-calculator.sk-yaho2026.chatgpt.site",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "http",
    }));

    expectCanonicalUrls(metadata);
    expect(JSON.stringify(metadata)).not.toContain("evil.example");
    expect(JSON.stringify(metadata)).not.toContain("http://");
  });

  it.each([
    ["localhost", "http://localhost/", "http://localhost/og-captain.png"],
    ["localhost:443", "http://localhost:443/", "http://localhost:443/og-captain.png"],
    ["localhost:65535", "http://localhost:65535/", "http://localhost:65535/og-captain.png"],
    ["127.0.0.1:3000", "http://127.0.0.1:3000/", "http://127.0.0.1:3000/og-captain.png"],
    ["[::1]:3100", "http://[::1]:3100/", "http://[::1]:3100/og-captain.png"],
  ])("uses HTTP only for the explicit local Host %s", (host, origin, imageUrl) => {
    const metadata = createMetadata(new Headers({
      "host": host,
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
    }));

    expect(metadata.openGraph).toMatchObject({
      url: origin,
      images: [{
        url: imageUrl,
      }],
    });
    expect(metadata.twitter).toMatchObject({
      images: [{
        url: imageUrl,
      }],
    });
    expect(JSON.stringify(metadata)).not.toContain("evil.example");
  });

  it.each([
    ["attacker domain", "evil.example"],
    ["attacker domain with port", "evil.example:8443"],
    ["public IPv6", "[2001:db8::1]:8443"],
    ["alternate IPv6 loopback spelling", "[0:0:0:0:0:0:0:1]:3100"],
    ["arbitrary ChatGPT Sites domain", "evil.chatgpt.site"],
    [
      "canonical lookalike",
      "planet-damage-calculator.sk-yaho2026.chatgpt.site.evil.example",
    ],
    [
      "canonical Host with a port",
      "planet-damage-calculator.sk-yaho2026.chatgpt.site:443",
    ],
  ])("falls back to the canonical origin for a valid non-loopback Host: %s", (_, host) => {
    const metadata = createMetadata(new Headers({
      "host": host,
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "http",
    }));

    expectCanonicalUrls(metadata);
    expect(JSON.stringify(metadata)).not.toContain("evil.example");
    expect(JSON.stringify(metadata)).not.toContain("http://");
  });

  it.each([
    ["missing", null],
    ["multi-value", "official.example,evil.example"],
    ["path", "official.example/path"],
    ["query", "official.example?next=evil"],
    ["userinfo", "user@official.example"],
    ["control character", "official.example\r\nevil.example"],
    ["empty port", "official.example:"],
    ["port zero", "official.example:0"],
    ["localhost empty port", "localhost:"],
    ["localhost port zero", "localhost:0"],
    ["localhost oversized port", "localhost:65536"],
    ["IPv4 loopback port zero", "127.0.0.1:0"],
    ["IPv6 loopback port zero", "[::1]:0"],
    ["oversized port", "official.example:65536"],
    ["unbracketed IPv6", "2001:db8::1"],
    ["malformed IPv6", "[::1"],
    ["non-decimal IPv4", "0x7f000001"],
    ["empty DNS label", "official..example"],
    ["invalid DNS label", "-official.example"],
  ])("uses the canonical fallback for an invalid direct Host: %s", (_, host) => {
    const requestHeaders: Pick<Headers, "get"> = {
      get(name) {
        const values: Record<string, string | null> = {
          host,
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "https",
        };
        return values[name.toLowerCase()] ?? null;
      },
    };

    const metadata = createMetadata(requestHeaders);

    expectCanonicalUrls(metadata);
    expect(JSON.stringify(metadata)).not.toContain("evil.example");
    expect(JSON.stringify(metadata)).not.toContain("http://");
    expect(JSON.stringify(metadata)).not.toContain("localhost");
  });

  it("ships the approved social image without changing its bytes", () => {
    const assetPath = resolve(process.cwd(), "public", "og.png");
    expect(existsSync(assetPath)).toBe(true);

    const bytes = readFileSync(assetPath);
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(bytes.readUInt32BE(16)).toBe(1536);
    expect(bytes.readUInt32BE(20)).toBe(1024);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "fde8386fe889c7670219911d39f72c226c81b19404a22976366a4c6bec9c11f2",
    );
  });

  it("ships the captain beta share image at the metadata dimensions", () => {
    const bytes = readFileSync(resolve(process.cwd(), "public", "og-captain.png"));
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
  });
});
