import { defineConfig } from "tsup";

// Angular's compiler works by reading decorator metadata. For libraries
// that tsup-bundles TS -> JS, we need:
//   - `emitDecoratorMetadata` (enabled in tsconfig.json)
//   - keep class names (no minification)
//   - target ES2022 so `accessor` fields emit cleanly
// This produces a partial-Ivy-compatible output that Angular 17's
// consumer-side compile step (ngcc-less world) happily processes.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  keepNames: true,
  external: [
    "@angular/common",
    "@angular/core",
    "@angular/router",
    "rxjs",
    "rxjs/operators",
  ],
  target: "es2022",
});
