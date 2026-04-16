import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    environmentOptions: {
      // Give happy-dom a concrete URL so history.replaceState/location work
      // the way browsers do. The default is about:blank which breaks path-
      // based tests.
      happyDOM: { url: "http://localhost/" },
    },
    globals: false,
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
