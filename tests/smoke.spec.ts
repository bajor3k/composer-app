import { test, expect } from "@playwright/test";

/**
 * Read-only smoke test: every top-level screen opens straight into the product.
 * There is no sign-in, so nothing should redirect to a login page and no API
 * call should come back 401. These tests never write to the database.
 */

const PAGES = [
  "/chat",
  "/accounts/portfolio",
  "/accounts/households",
  "/alerts",
  "/reports",
  "/communication/crm",
  "/knowledge/terminal",
];

for (const path of PAGES) {
  test(`${path} renders without a login`, async ({ page }) => {
    const unauthorized: string[] = [];
    page.on("response", (res) => {
      if (res.status() === 401) unauthorized.push(res.url());
    });

    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`${path}$`));

    // App chrome (sidebar) is present, and there is no password field anywhere.
    await expect(page.locator("aside, nav").first()).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    await page.waitForLoadState("networkidle");
    expect(unauthorized).toEqual([]);
  });
}

test("/ lands in the app", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/chat$/);
});

test("/api/auth/me returns the demo identity", async ({ request }) => {
  const res = await request.get("/api/auth/me");
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ id: "user_demo", name: "Demo User" });
});
