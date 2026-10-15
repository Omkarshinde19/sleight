import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    // The tracker model and WASM never change between deploys of the same version.
    const immutable = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];
    return [
      { source: "/models/:path*", headers: immutable },
      { source: "/mediapipe/:path*", headers: immutable },
    ];
  },
};

export default nextConfig;
