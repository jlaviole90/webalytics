import { defineConfig, devices } from "@playwright/test";

// Minimal Playwright config for the dogfood e2e.
// Assumes the demo + api are already running via docker-compose:
//   make up-demo && make seed
//
// Set BASE_URL / API_HOST to override targets in CI.
export default defineConfig({
  testDir: "./specs",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // shared backend state — keep serial
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
