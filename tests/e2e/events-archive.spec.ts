import { test, expect, type Page } from '@playwright/test';

// Regression suite for the /events historic archive: category filter + inline
// pagination. These assert on RENDERED visibility (`:visible`), not on the
// `hidden` attribute or internal JS state -- which is exactly the gap that let
// a broken filter ship (cards kept the attribute but still painted, because an
// author `display:flex` rule overrode the UA `[hidden]` rule).

const PAGE_SIZE = 9;
const TOTAL = 32;
const CATEGORY_TOTALS: Record<string, number> = {
  Conference: 13,
  Exhibition: 8,
  Networking: 6,
  Convention: 4,
  Meeting: 1,
};

const filter = (page: Page, category: string) =>
  page.locator(`.ev-filter[data-filter="${category}"]`);
const visibleCards = (page: Page) => page.locator('.ev-arch-card:visible');

test.beforeEach(async ({ page }) => {
  await page.goto('/events');
  // archive present and fully server-rendered (works with JS off / SEO)
  await expect(page.locator('.ev-arch-card')).toHaveCount(TOTAL);
});

test('initial state shows the first page of all events', async ({ page }) => {
  await expect(visibleCards(page)).toHaveCount(PAGE_SIZE);
});

test('each category filter shows only that category, rendered', async ({ page }) => {
  for (const [category, total] of Object.entries(CATEGORY_TOTALS)) {
    await filter(page, category).click();
    await expect(filter(page, category)).toHaveAttribute('aria-pressed', 'true');

    const expectedVisible = Math.min(total, PAGE_SIZE);
    await expect(visibleCards(page)).toHaveCount(expectedVisible);

    // every rendered card genuinely belongs to the active category
    const categories = await visibleCards(page).evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-category')),
    );
    expect(new Set(categories)).toEqual(new Set([category]));
  }
});

test('Meeting (single event) renders exactly one card and no Show more', async ({ page }) => {
  await filter(page, 'Meeting').click();
  await expect(visibleCards(page)).toHaveCount(1);
  await expect(page.locator('[data-events-more-row]')).toBeHidden();
});

test('Show more reveals the next page without navigating away', async ({ page }) => {
  await filter(page, 'Conference').click(); // 13 total, page size 9
  await expect(visibleCards(page)).toHaveCount(PAGE_SIZE);

  const moreBtn = page.locator('[data-events-more]');
  await expect(moreBtn).toBeVisible();
  await moreBtn.click();

  await expect(visibleCards(page)).toHaveCount(CATEGORY_TOTALS.Conference); // 13
  await expect(moreBtn).toBeHidden();
  await expect(page).toHaveURL(/\/events\/?$/); // no navigation occurred
});

test('changing filter resets pagination back to the first page', async ({ page }) => {
  await filter(page, 'Conference').click();
  await page.locator('[data-events-more]').click();
  await expect(visibleCards(page)).toHaveCount(CATEGORY_TOTALS.Conference);

  await filter(page, 'All').click();
  await expect(visibleCards(page)).toHaveCount(PAGE_SIZE);
  await expect(filter(page, 'All')).toHaveAttribute('aria-pressed', 'true');
});
