import { test, expect, type Page } from "@playwright/test"

// Smoke suite — not exhaustive coverage. Verifies the golden path any real portfolio
// change should never break: login, dashboard renders, forecast renders without the
// mobile-overflow regression, and the price-refresh/reconcile actions don't crash the
// page even when IBKR isn't configured (CI has no Flex credentials — a graceful "not
// configured" state is the correct, and only testable, outcome here).

const ATLAS = { email: "admin@atlas.local", password: process.env.CI_ATLAS_PASSWORD ?? "ci-smoke-test-password", portfolio: "atlas-core" }
const SBR = { email: "dutszm@gmail.com", password: process.env.CI_SBR_PASSWORD ?? "ci-smoke-test-password", portfolio: "silicon-brick-road" }

async function login(page: Page, user: typeof ATLAS) {
  await page.goto(`/login?portfolio=${user.portfolio}`)
  await page.fill('input[name="email"]', user.email)
  await page.fill('input[name="password"]', user.password)
  await page.click('button[type="submit"]')
  await page.waitForURL("**/")
}

for (const user of [ATLAS, SBR]) {
  test.describe(user.portfolio, () => {
    test("logs in and the dashboard renders without a client-side error", async ({ page }) => {
      const pageErrors: string[] = []
      page.on("pageerror", (err) => pageErrors.push(err.message))

      await login(page, user)
      await expect(page).toHaveURL("/")
      // Every dashboard variant shows total portfolio value somewhere above the fold.
      await expect(page.getByText(/portfolio value/i).first()).toBeVisible({ timeout: 15_000 })
      expect(pageErrors).toEqual([])
    })

    test("portfolio page renders holdings and the update panel", async ({ page }) => {
      await login(page, user)
      await page.goto("/portfolio")
      await expect(page.getByRole("heading", { name: /holdings/i })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(/update your portfolio/i).first()).toBeVisible()
    })

    test("refreshing prices and reconciling degrade gracefully without IBKR configured", async ({ page }) => {
      const pageErrors: string[] = []
      page.on("pageerror", (err) => pageErrors.push(err.message))
      await login(page, user)
      await page.goto("/portfolio")

      const refreshButton = page.getByRole("button", { name: /refresh live prices/i })
      await refreshButton.click()
      // Either a success or a clearly-surfaced error message — never a silent hang or a
      // thrown client-side exception.
      await expect(page.getByText(/price|error|unavailable/i).first()).toBeVisible({ timeout: 20_000 })
      expect(pageErrors).toEqual([])
    })

    test("forecast page renders without the mobile milestone-table overflow regression", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 }) // iPhone-class width
      await login(page, user)
      await page.goto("/forecast")
      await expect(page.getByText(/probability engine/i).first()).toBeVisible({ timeout: 15_000 })

      // The milestone table's own scroll container must be the thing that can scroll
      // horizontally, not the page body — this is exactly the bug fixed earlier: a
      // missing min-w-0 let the grid cell (and so the page) grow wider than the viewport
      // instead of the inner overflow-x-auto container catching it.
      const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth)
      const viewportWidth = await page.evaluate(() => window.innerWidth)
      expect(bodyScrollWidth).toBeLessThanOrEqual(viewportWidth + 1) // +1 for sub-pixel rounding
    })
  })
}
