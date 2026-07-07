import { test, expect } from "@playwright/test";

// panel-design slice (spec criterion E17). The portal + admin theme is LOCKED
// light (vault Design Source Brief: paper base, navy hero band - "decided, not
// open"). These tests pin the rendered theme so a future change cannot quietly
// regress the app surfaces to dark. The suite runs without a Convex deployment
// (admin-panel precedent), so only the signed-out shells are asserted.

// --paper from src/styles/tokens.css, as the browser computes it.
const PAPER = "rgb(246, 241, 232)";

test("portal sign-in shell renders on the light panel system", async ({ page }) => {
  await page.goto("/portal");
  await expect(page.getByRole("heading", { name: "Member sign-in" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Send sign-in link/ })).toBeVisible();
  await expect(page.locator("main#main")).toHaveClass(/panel-scope/);
  await expect(page.locator("main#main")).toHaveCSS("background-color", PAPER);
});

test("admin sign-in shell renders on the light panel system", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin sign-in" })).toBeVisible();
  await expect(page.locator("main#main")).toHaveCSS("background-color", PAPER);
});

test("join form section renders on the light panel system", async ({ page }) => {
  await page.goto("/join");
  await expect(page.getByRole("heading", { name: "Join WAI-ME" })).toBeVisible();
  await expect(page.locator(".panel-scope").first()).toHaveCSS(
    "background-color",
    PAPER,
  );
});

test("verify shell renders light and carries noindex", async ({ page }) => {
  // Also closes a recorded coverage gap: /verify noindex was never asserted.
  await page.goto("/verify");
  await expect(page.getByRole("heading", { name: "Verify a certificate" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
  await expect(page.locator("main#main")).toHaveCSS("background-color", PAPER);
});

test("guardian-confirm shell renders on the light panel system", async ({ page }) => {
  await page.goto("/guardian-confirm");
  await expect(
    page.getByRole("heading", { name: "Guardian confirmation" }),
  ).toBeVisible();
  await expect(page.locator("main#main")).toHaveCSS("background-color", PAPER);
});
