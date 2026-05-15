/**
 * Bundle the TypeScript source into ESM + CJS outputs using esbuild.
 *
 * Expects dist/fax.js and dist/fax.wasm to already exist (from make wasm).
 * Produces dist/index.mjs, dist/index.cjs, dist/worker.mjs, and .d.ts files.
 */

import { build } from "esbuild";
import { execSync } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");

if (!existsSync(resolve(dist, "fax.js"))) {
  console.error("Error: dist/fax.js not found. Run 'make wasm' first.");
  process.exit(1);
}

const shared = {
  bundle: true,
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  external: [
    "../../dist/fax.js", // keep the Emscripten glue as external
  ],
};

// ESM build
await build({
  ...shared,
  entryPoints: [resolve(root, "src/ts/index.ts")],
  outfile: resolve(dist, "index.mjs"),
  format: "esm",
});

// CJS build
await build({
  ...shared,
  entryPoints: [resolve(root, "src/ts/index.ts")],
  outfile: resolve(dist, "index.cjs"),
  format: "cjs",
});

// Worker entry (ESM only)
await build({
  ...shared,
  entryPoints: [resolve(root, "src/ts/worker.ts")],
  outfile: resolve(dist, "worker.mjs"),
  format: "esm",
});

// Generate .d.ts declarations
console.log("Generating type declarations...");
try {
  execSync("npx tsc --emitDeclarationOnly --outDir dist", {
    cwd: root,
    stdio: "inherit",
  });
} catch {
  console.warn("Warning: tsc declaration generation had issues (non-fatal).");
}

// Copy CJS declaration as .d.cts
const dtsPath = resolve(dist, "index.d.ts");
const dctsPath = resolve(dist, "index.d.cts");
if (existsSync(dtsPath)) {
  cpSync(dtsPath, dctsPath);
}

console.log("Bundle complete:");
console.log("  dist/index.mjs   (ESM)");
console.log("  dist/index.cjs   (CJS)");
console.log("  dist/worker.mjs  (Worker ESM)");
console.log("  dist/index.d.ts  (Types)");
console.log("  dist/index.d.cts (CJS Types)");
console.log("  dist/fax.js      (Emscripten glue)");
console.log("  dist/fax.wasm    (WASM binary)");
