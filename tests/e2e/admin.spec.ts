import { test, expect } from "@playwright/test";

// Admin-panel slice (spec criterion 11). The suite runs without a Convex
// deployment (guardian-consent precedent), so this exercises the /admin shell
// and its discovery guards only; authenticated queue rendering is covered at
// the Convex layer plus the design-review gate, not by Playwright sign-in.

test("admin page carries noindex and a noscript fallback", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
  const noscript = page.locator("noscript");
  await expect(noscript).toHaveCount(1);
});

test("admin is disallowed in robots.txt and absent from the sitemap", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.ok()).toBeTruthy();
  const body = await robots.text();
  expect(body).toContain("Disallow: /admin");

  const sitemap = await request.get("/sitemap-0.xml");
  expect(sitemap.ok()).toBeTruthy();
  expect(await sitemap.text()).not.toContain("/admin");
});

test("admin shows a sign-in shell for an unauthenticated visitor", async ({ page }) => {
  await page.goto("/admin");
  // The island renders the magic-link sign-in card when signed out; the server
  // check protects the data regardless of what the shell shows.
  await expect(
    page.getByRole("heading", { name: "Admin sign-in" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Send sign-in link/ })).toBeVisible();
});
