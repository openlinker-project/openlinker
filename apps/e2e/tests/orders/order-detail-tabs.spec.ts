/**
 * Orders: the order detail page is split into tabs (#4286)
 *
 * Read-only and self-configuring: it opens the newest order the stack holds and
 * mutates nothing. Skipped when the stack has no orders.
 *
 * Covers the contract the redesign must not break: the selected tab lives in
 * `?tab=`, the legacy anchors the orders and shipments lists link to still land
 * on the tab that holds them, panels of inactive tabs stay mounted, and the
 * page does not scroll sideways at a phone width.
 *
 * @module tests/orders
 */
import { test, expect } from '../../src/fixtures/test';

const TAB_LABELS = [
  'Overview',
  'Shipping',
  'Packing',
  'Sales documents',
  'Returns',
  'Notes',
  'History',
  'Technical',
] as const;

test.describe('orders: detail tabs (#4286)', () => {
  let orderId = '';

  test.beforeAll(async ({ api }) => {
    const list = await api.orders.list({ limit: 1, offset: 0 });
    orderId = list.items[0]?.internalOrderId ?? '';
  });

  test.beforeEach(() => {
    test.skip(orderId === '', 'stack has no orders');
  });

  test('lists every section as a tab and opens Overview by default', async ({ page }) => {
    await page.goto(`/orders/${orderId}`);
    const tablist = page.getByRole('tablist');
    await expect(tablist).toBeVisible();
    for (const label of TAB_LABELS) {
      await expect(tablist.getByRole('tab', { name: new RegExp(`^${label}`) })).toBeVisible();
    }
    await expect(tablist.getByRole('tab', { name: /^Overview/ })).toHaveAttribute(
      'data-state',
      'active',
    );
  });

  test('shows exactly one tab panel at a time', async ({ page }) => {
    // Radix keeps a force-mounted panel visible, so hiding the inactive ones is
    // our own CSS rule: without it every tab renders the same long page.
    for (const tab of ['overview', 'shipping', 'packing', 'documents', 'technical']) {
      await page.goto(`/orders/${orderId}?tab=${tab}`);
      await expect(page.getByRole('tablist')).toBeVisible();
      await expect(page.locator('[role="tabpanel"]:visible')).toHaveCount(1);
    }
  });

  test('keeps the selected tab in ?tab= across a reload', async ({ page }) => {
    await page.goto(`/orders/${orderId}`);
    await page.getByRole('tab', { name: /^Notes/ }).click();
    await expect(page).toHaveURL(/tab=notes/);
    await page.reload();
    await expect(page.getByRole('tab', { name: /^Notes/ })).toHaveAttribute('data-state', 'active');
  });

  for (const [anchor, tab] of [
    ['shipment', 'Shipping'],
    ['packing', 'Packing'],
    ['invoicing', 'Sales documents'],
    ['order-raw-snapshot', 'Technical'],
  ] as const) {
    test(`opens the ${tab} tab for the legacy #${anchor} anchor`, async ({ page }) => {
      await page.goto(`/orders/${orderId}#${anchor}`);
      await expect(page.getByRole('tab', { name: new RegExp(`^${tab}`) })).toHaveAttribute(
        'data-state',
        'active',
      );
    });
  }

  test('does not scroll sideways at a phone width, on any tab', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 900 });
    for (const tab of ['overview', 'shipping', 'packing', 'documents', 'returns', 'notes', 'history', 'technical']) {
      await page.goto(`/orders/${orderId}${tab === 'overview' ? '' : `?tab=${tab}`}`);
      await expect(page.getByRole('tablist')).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(overflow, `horizontal scroll on the ${tab} tab`).toBe(false);
    }
  });
});
