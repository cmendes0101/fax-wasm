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

  // Replace emcc's UMD footer with a plain ESM `export default`. The UMD
  // tail only worked under classic CommonJS `require()` paths, and this
  // package is published as `"type": "module"` — every consumer (the
  // bundled .mjs/.cjs entries, the worker, and external bundlers) loads
  // fax.js via dynamic `import()`, which goes through Node's ESM
  // loader. Without an explicit `export default`, the loader saw an
  // empty namespace; *with* the UMD branch still present, some loaders
  // additionally tripped on `module.exports = ...` because their
  // synthetic `module` shim is a read-only Module namespace. Swapping
  // the UMD footer for a single `export default` resolves both failure
  // modes (and is what surfaced as "e is not a function" in webpack's
  // minified worker chunks).
  const UMD_FOOTER_RE =
    /if \(typeof exports === 'object' && typeof module === 'object'\)[\s\S]+?define\(\[\], \(\) => createFaxModule\);?\s*$/m;
  const ESM_FOOTER = "export default createFaxModule;\n";
  if (UMD_FOOTER_RE.test(glue)) {
    glue = glue.replace(UMD_FOOTER_RE, ESM_FOOTER);
  } else if (!glue.includes("export default createFaxModule")) {
    // Fallback: footer wasn't where we expected — append rather than
    // miss it entirely.
    glue += "\n" + ESM_FOOTER;
  }

  writeFileSync(faxJsPath, glue);
  console.log(
    `  rewrote dist/fax.js (browser-safe variant): ${neutralized} require() ` +
      `call(s) neutralized, UMD footer replaced with ESM default export`,
  );

  // Same swap for the Node copy, plus a Node-ESM compatibility shim.
  // Both `dist/index.node.mjs` and `dist/index.node.cjs` consume
  // fax.node.js via dynamic `import()`, so it's always loaded as ESM
  // under the package's `"type": "module"`. The pristine emcc glue
  // uses `__dirname` inside its `if (ENVIRONMENT_IS_NODE) { ... }`
  // branch — which is a CJS-only global, not defined in ESM. Prepend
  // a `node:url`-based shim that recreates `__dirname` / `__filename`
  // so the Node branch runs cleanly under ESM.
  //
  // (Direct `require("./fax.node.js")` already fails with
  // ERR_REQUIRE_ESM under `type: module`, so swapping the UMD footer
  // out here is observable to no one.)
  const NODE_ESM_SHIM = [
    'import { fileURLToPath as __faxFileURLToPath } from "node:url";',
    'import { dirname as __faxDirname } from "node:path";',
    'import { createRequire as __faxCreateRequire } from "node:module";',
    "const __filename = __faxFileURLToPath(import.meta.url);",
    "const __dirname = __faxDirname(__filename);",
    "const require = __faxCreateRequire(import.meta.url);",
    "",
  ].join("\n");

  let nodeGlue = readFileSync(faxNodePath, "utf8");
  if (UMD_FOOTER_RE.test(nodeGlue)) {
    nodeGlue = nodeGlue.replace(UMD_FOOTER_RE, ESM_FOOTER);
  } else if (!nodeGlue.includes("export default createFaxModule")) {
    nodeGlue += "\n" + ESM_FOOTER;
  }
  if (!nodeGlue.includes("__faxFileURLToPath")) {
    nodeGlue = NODE_ESM_SHIM + nodeGlue;
  }
  writeFileSync(faxNodePath, nodeGlue);
  console.log(
    `  prepared dist/fax.node.js: Node-ESM shim prepended, ESM default export ensured`,
  );
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
