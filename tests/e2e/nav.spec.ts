import { test, expect } from '@playwright/test';

// Regression for the nav fix: the primary nav and footer must point at real
// pages, never dead in-page anchors (#what) or a mailto: Contact.

const NAV = [
  { label: 'About', path: '/about' },
  { label: 'Membership', path: '/membership' },
  { label: 'Get Involved', path: '/get-involved' },
  { label: 'Events', path: '/events' },
  { label: 'Contact', path: '/contact' },
];

test('no primary-nav link is a dead anchor or mailto', async ({ page }) => {
  await page.goto('/');
  const hrefs = await page
    .locator('header .links a')
    .evaluateAll((els) => els.map((e) => e.getAttribute('href') || ''));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) {
    expect(href, `nav href "${href}" should be a real route`).not.toMatch(/^#/);
    expect(href, `nav href "${href}" should not be mailto`).not.toMatch(/^mailto:/);
  }
});

for (const { label, path } of NAV) {
  test(`nav "${label}" navigates to ${path}`, async ({ page }) => {
    await page.goto('/');
    await page.locator('header .links a', { hasText: new RegExp(`^${label}$`) }).click();
    await expect(page).toHaveURL(new RegExp(`${path.replace(/\//g, '\\/')}\\/?$`));
  });
}

test('footer Explore column links to real pages, not anchors', async ({ page }) => {
  await page.goto('/');
  const hrefs = await page
    .locator('footer a')
    .evaluateAll((els) => els.map((e) => e.getAttribute('href') || ''));
  const internalNav = hrefs.filter((h) => h && !h.startsWith('mailto:') && !h.startsWith('http'));
  for (const href of internalNav) {
    expect(href, `footer href "${href}" should not be an in-page anchor`).not.toMatch(/^#/);
  }
});
