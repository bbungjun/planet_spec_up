import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  webpack(config, { isServer }) {
    // OpenCV includes a Node-only branch. OCR uses its browser/WASM branch.
    if (!isServer) config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    return config;
  },
};

export default nextConfig;
