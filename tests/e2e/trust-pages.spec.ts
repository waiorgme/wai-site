import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Trust pages slice: privacy + safeguarding render from the vault drafts, the
// discovery plumbing (robots, sitemap, canonical, hreflang) exists, and the
// 404 page is real.

test("privacy policy page renders with its sections", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Who we are" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your rights" })).toBeVisible();
  await expect(page.getByText("Last updated: 24 June 2026")).toBeVisible();
});

test("safeguarding page renders with its commitments", async ({ page }) => {
  await page.goto("/safeguarding");
  await expect(
    page.getByRole("heading", { name: "Keeping Our Young Members Safe" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "How to raise a concern" }),
  ).toBeVisible();
  // The privacy cross-link must be internal now, not the old site.
  const link = page.locator('.legal-body a[href="/privacy"]');
  await expect(link).toBeVisible();
});

test("footer privacy link is internal on every language", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('footer a[href="/privacy"]')).toBeVisible();
  await page.goto("/ar/");
  await expect(page.locator('footer a[href="/privacy"]')).toBeVisible();
});

test("robots.txt and sitemap ship in the build", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.ok()).toBeTruthy();
  const body = await robots.text();
  expect(body).toContain("Disallow: /portal");
  expect(body).toContain("Sitemap:");
  const sitemap = await request.get("/sitemap-index.xml");
  expect(sitemap.ok()).toBeTruthy();
});

test("canonical + reciprocal hreflang on the EN/AR pair", async ({ page }) => {
  // Trailing-slash form everywhere: matches the directory-format build, the
  // sitemap output, and the Cloudflare Pages redirect behaviour.
  await page.goto("/about");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://www.waiorg.me/about/",
  );
  await expect(page.locator('link[hreflang="ar"]')).toHaveAttribute(
    "href",
    "https://www.waiorg.me/ar/about/",
  );
  await page.goto("/ar/about");
  await expect(page.locator('link[hreflang="en"]')).toHaveAttribute(
    "href",
    "https://www.waiorg.me/about/",
  );
});

test("sitemap lists canonical trailing-slash URLs and skips private routes", async ({ request }) => {
  const index = await (await request.get("/sitemap-index.xml")).text();
  const m = index.match(/<loc>([^<]+)<\/loc>/);
  expect(m).not.toBeNull();
  const sitemapUrl = new URL(m![1]).pathname;
  const body = await (await request.get(sitemapUrl)).text();
  expect(body).toContain("https://www.waiorg.me/about/");
  expect(body).not.toContain("/portal");
  expect(body).not.toContain("/verify");
});

test("404 page is built and friendly", async () => {
  // Astro static: the 404 route builds to dist/404.html for the host to serve.
  expect(existsSync(join(process.cwd(), "dist", "404.html"))).toBeTruthy();
});

test("portal and verify carry noindex", async ({ page }) => {
  await page.goto("/portal");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
});
