import { defineConfig } from "tsup";

// Three bundles:
//   - index.js  (ESM)  — primary entry for bundlers (webpack, vite, rollup)
//   - index.cjs (CJS)  — for Node.js `require()` consumers
//   - tracker.umd.js    — standalone <script> include with window.webalytics
//
// We keep esbuild's minifier because the size budget is <2KB gzipped for the
// core. A separate size-check script asserts that after build.
export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    minify: false,
    target: "es2020",
    outDir: "dist",
  },
  {
    entry: { tracker: "src/umd.ts" },
    format: ["iife"],
    globalName: "webalytics",
    outExtension: () => ({ js: ".umd.js" }),
    sourcemap: true,
    minify: true,
    target: "es2020",
    outDir: "dist",
  },
]);
