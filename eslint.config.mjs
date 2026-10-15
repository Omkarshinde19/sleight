import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Physics and scene code keeps per-frame runtime state (rigid bodies, trails, hand followers)
    // outside React and mutates it from useFrame/physics callbacks on purpose.
    files: ["src/components/physics/**", "src/scenes/**", "src/components/landing/LandingStage.tsx"],
    rules: { "react-hooks/refs": "off", "react-hooks/immutability": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored MediaPipe WASM glue copied in by scripts/copy-mediapipe.mjs.
    "public/mediapipe/**",
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
