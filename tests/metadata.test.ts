import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createMetadata } from "@/app/layout";

const title = "플래닛 데미지 계산기";
const description =
  "신궁, 캡틴, 나이트로드의 장비 스탯과 환산 공격력을 빠르게 계산합니다.";

describe("social metadata", () => {
  it("uses the forwarded request origin for absolute Open Graph and X images", () => {
    const metadata = createMetadata(new Headers({
      "host": "internal.example:8787",
      "x-forwarded-host": "planet.example, proxy.internal",
      "x-forwarded-proto": "https, http",
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
        url: "https://planet.example/",
        images: [{
          url: "https://planet.example/og.png",
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
          url: "https://planet.example/og.png",
          alt: title,
        }],
      },
    });
  });

  it("rejects forwarded path and protocol injection before using the host fallback", () => {
    const metadata = createMetadata(new Headers({
      "host": "guild.example:8443",
      "x-forwarded-host": "attacker.example/steal?next=/og.png",
      "x-forwarded-proto": "javascript",
    }));

    expect(metadata.openGraph).toMatchObject({
      url: "https://guild.example:8443/",
      images: [{
        url: "https://guild.example:8443/og.png",
      }],
    });
    expect(JSON.stringify(metadata)).not.toContain("attacker.example");
    expect(JSON.stringify(metadata)).not.toContain("javascript:");
  });

  it("uses HTTP only for a local request when no forwarded protocol exists", () => {
    const metadata = createMetadata(new Headers({
      "host": "localhost:3000",
    }));

    expect(metadata.openGraph).toMatchObject({
      url: "http://localhost:3000/",
      images: [{
        url: "http://localhost:3000/og.png",
      }],
    });
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
