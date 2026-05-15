/**
 * Bundle the TypeScript source into ESM + CJS outputs using esbuild.
 *
 * Expects dist/fax.js to already exist (from `make wasm`). The wasm
 * binary itself is inlined into fax.js as base64 (SINGLE_FILE=1), so
 * there is no separate dist/fax.wasm artifact.
 *
 * Produces:
 *
 *   dist/index.mjs        ESM, browser-safe glue (dist/fax.js)
 *   dist/index.cjs        CJS, browser-safe glue (dist/fax.js)
 *   dist/index.node.mjs   ESM, Node-targeted glue (dist/fax.node.js)
 *   dist/index.node.cjs   CJS, Node-targeted glue (dist/fax.node.js)
 *   dist/worker.mjs       ESM, browser-only worker (dist/fax.js)
 *   dist/*.d.ts           tsc-generated type declarations
 *
 * Consumer routing happens via the `exports.node` condition in
 * package.json — Node imports get the `.node.{mjs,cjs}` artifacts,
 * everything else gets the browser-safe variants.
 */

import { build } from "esbuild";
import { execSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");

if (!existsSync(resolve(dist, "fax.js"))) {
  console.error("Error: dist/fax.js not found. Run 'make wasm' first.");
  process.exit(1);
}

// loader.ts dynamic-imports `../../dist/fax.node.js` so vitest can run the
// un-stripped Node-flavored glue directly. We keep that literal path as an
// esbuild external so the bundled output still carries the string verbatim;
// the post-build rewrite below substitutes it for the per-target sibling
// path (`./fax.js` for browser, `./fax.node.js` for Node).
const externalGlue = ["../../dist/fax.node.js"];

const shared = {
  bundle: true,
  target: "es2022",
  sourcemap: true,
  external: externalGlue,
};

// Browser-targeted main entry (ESM + CJS)
await build({
  ...shared,
  platform: "browser",
  entryPoints: [resolve(root, "src/ts/index.ts")],
  outfile: resolve(dist, "index.mjs"),
  format: "esm",
});
await build({
  ...shared,
  platform: "browser",
  entryPoints: [resolve(root, "src/ts/index.ts")],
  outfile: resolve(dist, "index.cjs"),
  format: "cjs",
});

// Node-targeted main entry (ESM + CJS). Same source; bundling under
// `platform: "node"` keeps emcc's `require("fs"|"path"|"crypto")` paths
// (in the bundled `fax.node.js`) reachable instead of being stripped or
// warned about.
await build({
  ...shared,
  platform: "node",
  entryPoints: [resolve(root, "src/ts/index.ts")],
  outfile: resolve(dist, "index.node.mjs"),
  format: "esm",
});
await build({
  ...shared,
  platform: "node",
  entryPoints: [resolve(root, "src/ts/index.ts")],
  outfile: resolve(dist, "index.node.cjs"),
  format: "cjs",
});

// Worker entry (browser ESM only — workers are a browser/Web Worker
// concept; Node uses `worker_threads` with a different API).
await build({
  ...shared,
  platform: "browser",
  entryPoints: [resolve(root, "src/ts/worker.ts")],
  outfile: resolve(dist, "worker.mjs"),
  format: "esm",
});

console.log("Generating type declarations...");
try {
  execSync("npx tsc --emitDeclarationOnly --outDir dist", {
    cwd: root,
    stdio: "inherit",
  });
} catch {
  console.warn("Warning: tsc declaration generation had issues (non-fatal).");
}

const dtsPath = resolve(dist, "index.d.ts");
const dctsPath = resolve(dist, "index.d.cts");
if (existsSync(dtsPath)) {
  cpSync(dtsPath, dctsPath);
}

// ---------------------------------------------------------------------
// Post-bundle fix-ups for the Emscripten glue
// ---------------------------------------------------------------------
//
// Two problems we solve here:
//
// 1. Path: `loader.ts` uses `import("../../dist/fax.node.js")` so the
//    relative path resolves when vitest runs the TypeScript source
//    directly (`src/ts/loader.ts` → `../../dist/fax.node.js`). After
//    esbuild bundles loader.ts into `dist/*.{mjs,cjs}`, that same
//    string would traverse OUT of the package's `dist/` tree at
//    runtime. We rewrite it to the appropriate sibling path so the
//    published artifacts resolve the glue from inside `dist/`.
//
// 2. Node built-ins in browser bundles: emcc emits `require("fs"|"path"
//    |"crypto")` inside a dead `if (ENVIRONMENT_IS_NODE)` branch. Those
//    calls are unreachable in browsers but Webpack / Turbopack still
//    resolve them statically and abort the build with "Module not
//    found". To keep Node-mode tests + the Node export condition
//    working AND ship a browser-safe artifact, we fork the emcc output:
//
//      • `dist/fax.node.js` — pristine glue, used by vitest and the
//                             `node` exports condition.
//      • `dist/fax.js`      — browser-safe, with the three dead
//                             require() calls swapped for `null` so
//                             bundlers see no references at all.

const faxJsPath = resolve(dist, "fax.js");
const faxNodePath = resolve(dist, "fax.node.js");

if (existsSync(faxJsPath)) {
  // Snapshot the pristine glue as the Node copy first. We always
  // overwrite so a stale fax.node.js from an earlier build can't drift
  // from the current emcc output.
  cpSync(faxJsPath, faxNodePath);

  // Now strip the Node-only require() calls from the browser copy. The
  // assignments are inside `if (ENVIRONMENT_IS_NODE) { ... }` so the
  // resulting `null` values are never read at runtime in browsers.
  let glue = readFileSync(faxJsPath, "utf8");
  const NEUTRALIZE = [
    { from: 'require("fs")', to: "null" },
    { from: 'require("path")', to: "null" },
    { from: 'require("crypto")', to: "null" },
  ];
  let neutralized = 0;
  for (const { from, to } of NEUTRALIZE) {
    if (glue.includes(from)) {
      glue = glue.split(from).join(to);
      neutralized += 1;
    }
  }
  if (neutralized > 0) {
    writeFileSync(faxJsPath, glue);
    console.log(
      `  neutralized ${neutralized} Node require() call(s) in dist/fax.js (browser-safe variant)`,
    );
  }
}

// Per-target glue-path rewrites: browser artifacts point at the
// neutralized `./fax.js`; Node artifacts point at the pristine
// `./fax.node.js`.
const REWRITE_TARGETS = [
  { files: ["index.mjs", "index.cjs", "worker.mjs"], to: "./fax.js" },
  { files: ["index.node.mjs", "index.node.cjs"], to: "./fax.node.js" },
];
for (const { files, to } of REWRITE_TARGETS) {
  const replacements = [
    { from: '"../../dist/fax.node.js"', to: `"${to}"` },
    { from: "'../../dist/fax.node.js'", to: `'${to}'` },
  ];
  for (const file of files) {
    const p = resolve(dist, file);
    if (!existsSync(p)) continue;
    let src = readFileSync(p, "utf8");
    let touched = false;
    for (const r of replacements) {
      if (src.includes(r.from)) {
        src = src.split(r.from).join(r.to);
        touched = true;
      }
    }
    if (touched) {
      writeFileSync(p, src);
      console.log(`  rewrote glue import path in dist/${file} -> ${to}`);
    }
  }
}

console.log("Bundle complete:");
console.log("  dist/index.mjs        (ESM, browser)");
console.log("  dist/index.cjs        (CJS, browser)");
console.log("  dist/index.node.mjs   (ESM, Node)");
console.log("  dist/index.node.cjs   (CJS, Node)");
console.log("  dist/worker.mjs       (Worker ESM, browser-only)");
console.log("  dist/index.d.ts       (Types)");
console.log("  dist/index.d.cts      (CJS Types)");
console.log("  dist/fax.js           (Emscripten glue, browser-safe)");
console.log("  dist/fax.node.js      (Emscripten glue, Node)");
