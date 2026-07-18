import { defineConfig, devices } from "@playwright/test"

// CI smoke suite only — not a full E2E harness. Runs against a throwaway local SQLite DB
// (see scripts/ci-seed.ts), never against production. webServer starts `next start` itself
// so `npx playwright test` is self-contained once the DB is seeded and the app is built.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } } : {}),
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // Not `npm run start` — that also runs scripts/init-db.mjs, a legacy bootstrap for a
    // hand-maintained schema that predates most of prisma/schema.prisma and depends on
    // better-sqlite3 (not a project dependency). The DB is already prepared by
    // `prisma db push` + scripts/ci-seed.ts before this runs.
    command: "npx next start -p 3100",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
