// Builds the runtime models: every assets/blender/<name>.blend becomes public/models/<name>.glb.
//
//   npm run assets            # all .blend files
//   npm run assets -- hand    # just assets/blender/hand.blend
//
// Step 1 exports with headless Blender (scripts/blender/export.py); step 2 compresses with
// gltf-transform: meshopt geometry (drei's useGLTF decodes it by default) and WebP textures, no
// simplify/join/flatten/palette, so node, bone and material names survive — code looks them up by name.
// BLENDER overrides the Blender binary (default: the macOS app bundle).

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const srcDir = join(root, "assets/blender");
const outDir = join(root, "public/models");
const blender = process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender";
const gltfTransform = join(root, "node_modules/.bin/gltf-transform");

const only = process.argv.slice(2);
const names = readdirSync(srcDir)
  .filter((f) => f.endsWith(".blend"))
  .map((f) => basename(f, ".blend"))
  .filter((n) => only.length === 0 || only.includes(n));

if (names.length === 0) {
  console.error(only.length ? `no assets/blender/{${only.join(",")}}.blend` : "no .blend files in assets/blender");
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), "sleight-assets-"));
try {
  for (const name of names) {
    const raw = join(tmp, `${name}.glb`);
    const out = join(outDir, `${name}.glb`);
    execFileSync(blender, ["-b", join(srcDir, `${name}.blend`), "--python", join(root, "scripts/blender/export.py"), "--", raw], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    execFileSync(
      gltfTransform,
      [
        "optimize", raw, out,
        "--compress", "meshopt",
        "--texture-compress", "webp",
        "--texture-size", "2048",
        "--simplify", "false",
        "--join", "false",
        "--flatten", "false",
        "--instance", "false",
        "--palette", "false",
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    const kb = (f) => (statSync(f).size / 1024).toFixed(1);
    console.log(`${name}: ${kb(raw)} KB → public/models/${name}.glb ${kb(out)} KB`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
