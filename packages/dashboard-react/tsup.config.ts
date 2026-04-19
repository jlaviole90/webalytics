import { defineConfig } from "tsup";

// bundle: false compiles each file individually so "use client" directives
// are preserved in their respective output files. Next.js App Router traces
// through re-exports and respects those boundaries correctly.
export default defineConfig({
  entry: ["src/**/*.ts", "src/**/*.tsx"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  bundle: false,
  external: ["react", "react-dom"],
  target: "es2022",
});
