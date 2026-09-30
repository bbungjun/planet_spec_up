import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export default async function nextConfig(phase: string): Promise<NextConfig> {
  // Read private host data during local startup only, outside the traced app modules.
  const localDefault = phase === PHASE_DEVELOPMENT_SERVER && !process.env.VERCEL
    ? await readFile(join(process.cwd(), "output", "development-default-setup.json"), "utf8").catch(() => "")
    : "";
  return {
    outputFileTracingRoot: process.cwd(),
    env: { PLANET_LOCAL_DEFAULT_SETUP: localDefault },
    webpack(config, { isServer }) {
      // OpenCV includes a Node-only branch. OCR uses its browser/WASM branch.
      if (!isServer) config.resolve.fallback = { ...config.resolve.fallback, fs: false };
      return config;
    },
  };
}
