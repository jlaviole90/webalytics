import { defineConfig } from "tsup";

// Two entrypoints:
//   - index.ts: App Router component (default export Webalytics + hooks)
//   - pages.ts: Pages Router integration (_app helper)
//
// Both emit ESM + CJS + .d.ts. React stays external so consumers share the
// same instance across the app.
export default defineConfig({
  entry: {
    index: "src/index.tsx",
    pages: "src/pages.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["react", "react-dom", "next", "next/navigation", "next/router", "next/script"],
  target: "es2020",
  outDir: "dist",
  banner: (ctx) => {
    // Mark the client entry as a React client component. This lets consumers
    // import it from server components without wrapping in a "use client"
    // file of their own.
    if (ctx.format === "esm" || ctx.format === "cjs") {
      return { js: '"use client";' };
    }
    return {};
  },
});
