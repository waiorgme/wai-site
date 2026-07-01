import { test, expect } from "@playwright/test";

// The Join form shell (PRD §6.2). These assert on RENDERED state: the island
// mounts, the decided gender field shows exactly Female/Male with Female
// pre-selected, the guardian branch appears for a 13-17 DOB, and the honeypot
// stays invisible. No Convex deployment is involved.

test("join form renders the PRD §6.2 fields", async ({ page }) => {
  await page.goto("/join");
  await expect(page.getByRole("heading", { name: "Join WAI-ME" })).toBeVisible();
  await expect(page.getByLabel("First name")).toBeVisible();
  await expect(page.getByLabel("Last name")).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Country")).toBeVisible();
  await expect(page.getByLabel("Date of birth")).toBeVisible();
  await expect(
    page.getByText("I confirm my details, including age and gender, are accurate."),
  ).toBeVisible();
});

test("gender field is exactly Female / Male with Female pre-selected", async ({ page }) => {
  await page.goto("/join");
  const radios = page.locator('input[name="gender"]');
  await expect(radios).toHaveCount(2);
  await expect(page.getByRole("radio", { name: "Female", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Male", exact: true })).not.toBeChecked();
  // The old labels must never come back.
  await expect(page.getByRole("radio", { name: "Woman", exact: true })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Ally", exact: true })).toHaveCount(0);
});

test("a 13-17 date of birth reveals the guardian branch and hides the partner-search option", async ({ page }) => {
  await page.goto("/join");
  await expect(page.getByLabel("Parent or guardian's name")).toHaveCount(0);
  await expect(page.getByText("Make my profile searchable")).toBeVisible();
  await page.getByLabel("Date of birth").fill("2011-01-15");
  await expect(page.getByLabel("Parent or guardian's name")).toBeVisible();
  await expect(page.getByLabel("Parent or guardian's email")).toBeVisible();
  // Safeguarding: the partner-search consent is never offered to minors.
  await expect(page.getByText("Make my profile searchable")).toHaveCount(0);
});

test("honeypot field exists but is not visible", async ({ page }) => {
  await page.goto("/join");
  const honeypot = page.locator('input[name="website"]');
  await expect(honeypot).toHaveCount(1);
  await expect(honeypot).not.toBeVisible();
});
