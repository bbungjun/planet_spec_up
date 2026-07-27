import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createMetadata } from "@/app/layout";

const title = "플래닛 데미지 계산기";
const description =
  "신궁, 캡틴, 나이트로드의 장비 스탯과 환산 공격력을 빠르게 계산합니다.";

describe("social metadata", () => {
  it("ignores spoofed forwarded headers and uses the direct Host authority", () => {
    const metadata = createMetadata(new Headers({
      "host": "official.example:8443",
      "x-forwarded-host": "evil.example:8080",
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
        url: "https://official.example:8443/",
        images: [{
          url: "https://official.example:8443/og.png",
          width: 1536,
          height: 1024,
          alt: title,
        }],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [{
          url: "https://official.example:8443/og.png",
          alt: title,
        }],
      },
    });
    expect(JSON.stringify(metadata)).not.toContain("evil.example");
    expect(JSON.stringify(metadata)).not.toContain("http://");
  });

  it.each([
    ["localhost", "http://localhost/og.png"],
    ["localhost:443", "http://localhost:443/og.png"],
    ["127.0.0.1:3000", "http://127.0.0.1:3000/og.png"],
    ["[::1]:3100", "http://[::1]:3100/og.png"],
  ])("uses HTTP only for the explicit local Host %s", (host, imageUrl) => {
    const metadata = createMetadata(new Headers({
      "host": host,
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
    }));

    expect(metadata.openGraph).toMatchObject({
      images: [{
        url: imageUrl,
      }],
    });
    expect(JSON.stringify(metadata)).not.toContain("evil.example");
  });

  it.each([
    ["guild.example:8443", "https://guild.example:8443/og.png"],
    ["guild.example:80", "https://guild.example:80/og.png"],
    ["[2001:db8::1]:8443", "https://[2001:db8::1]:8443/og.png"],
  ])("uses HTTPS and preserves the valid Host authority %s", (host, imageUrl) => {
    const metadata = createMetadata(new Headers({
      "host": host,
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "http",
    }));

    expect(metadata.openGraph).toMatchObject({
      images: [{
        url: imageUrl,
      }],
    });
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
    ["oversized port", "official.example:65536"],
    ["unbracketed IPv6", "2001:db8::1"],
    ["malformed IPv6", "[::1"],
    ["non-decimal IPv4", "0x7f000001"],
    ["empty DNS label", "official..example"],
    ["invalid DNS label", "-official.example"],
  ])("uses a local fallback for an invalid direct Host: %s", (_, host) => {
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

    expect(metadata.openGraph).toMatchObject({
      url: "http://localhost/",
      images: [{
        url: "http://localhost/og.png",
      }],
    });
    expect(metadata.twitter).toMatchObject({
      images: [{
        url: "http://localhost/og.png",
      }],
    });
    expect(JSON.stringify(metadata)).not.toContain("evil.example");
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
});
