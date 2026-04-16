import { defineConfig } from "tsup";

// RSC-safe bundling: no "use client" directives on any of these entries,
// so Next.js treats every component as a Server Component by default.
// Anything that needs interactivity (Realtime auto-refresh, expand/collapse)
// is deferred to the caller and documented in the README.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ["react", "react-dom"],
  target: "es2022",
});
