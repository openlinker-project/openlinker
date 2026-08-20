/**
 * Orders: the filtered empty state tells the truth (#2148)
 *
 * `/orders` used to answer "No order records have been synced yet" whenever any
 * filter other than `health` yielded zero rows — a statement about the whole
 * dataset, read by an operator who has thousands of orders and simply filtered
 * to a narrow slice. Its only action was a link to `/connections`, which left
 * the filter applied and pointed at an ingestion problem that did not exist.
 *
 * Read-only and self-configuring: every case narrows with a URL param that
 * cannot match anything (a `createdFrom` in the far future), so the assertions
 * hold against a demo database, a fresh one, or a stack mid-ingestion. Nothing
 * is created, mutated or deleted.
 *
 * @module tests/orders
 */
import { test, expect } from '../../src/fixtures/test';

/** Guaranteed-empty regardless of what the stack holds. */
const IMPOSSIBLE_FROM = '2099-01-01';

const NARROWING_QUERIES: ReadonlyArray<readonly [label: string, query: string]> = [
  ['ship-by SLA chip', `due=breaching&createdFrom=${IMPOSSIBLE_FROM}`],
  ['SLA state', `slaState=overdue&createdFrom=${IMPOSSIBLE_FROM}`],
  ['fulfillment state', `fulfillmentState=not-shipped&createdFrom=${IMPOSSIBLE_FROM}`],
  ['created-from date alone', `createdFrom=${IMPOSSIBLE_FROM}`],
];

test.describe('orders: filtered empty state (#2148)', () => {
  for (const [label, query] of NARROWING_QUERIES) {
    test(`states that nothing matched, not that nothing synced — ${label}`, async ({ page }) => {
      await page.goto(`/orders?${query}`);

      await expect(page.getByText('No orders in this view')).toBeVisible();

      // The regression: a dataset-wide claim shown for a narrow filter.
      await expect(page.getByText(/No order records have been synced yet/i)).toHaveCount(0);

      // And the action must clear the filter rather than send the operator to
      // /connections to debug an outage that is not happening.
      await expect(page.getByRole('button', { name: 'View all orders' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Manage connections' })).toHaveCount(0);
    });
  }

  test('the recovery button clears every filter in one navigation', async ({ page, api }) => {
    const total = (await api.orders.list({ limit: 1, offset: 0 })).total;
    test.skip(total === 0, 'stack has no orders, so "all orders" is itself empty');

    await page.goto(
      `/orders?due=breaching&slaState=overdue&fulfillmentState=not-shipped&createdFrom=${IMPOSSIBLE_FROM}`,
    );
    await expect(page.getByText('No orders in this view')).toBeVisible();

    await page.getByRole('button', { name: 'View all orders' }).click();

    // One `setSearchParams` write, so every axis goes at once. Clearing them one
    // call at a time would leave all but the last applied — React Router builds
    // the next params from the current render's params, not from a queue.
    await expect(page).toHaveURL(/\/orders(\?.*)?$/);
    const url = new URL(page.url());
    for (const key of ['due', 'slaState', 'fulfillmentState', 'createdFrom', 'createdTo']) {
      expect(url.searchParams.get(key), `${key} should be cleared`).toBeNull();
    }

    // And the list is genuinely back: rows, not another empty state.
    await expect(page.getByText('No orders in this view')).toHaveCount(0);
  });

  test('sort and direction survive the clear — they narrow nothing', async ({ page, api }) => {
    const total = (await api.orders.list({ limit: 1, offset: 0 })).total;
    test.skip(total === 0, 'stack has no orders, so "all orders" is itself empty');

    await page.goto(`/orders?createdFrom=${IMPOSSIBLE_FROM}&sort=createdAt&dir=asc`);
    await expect(page.getByText('No orders in this view')).toBeVisible();

    await page.getByRole('button', { name: 'View all orders' }).click();

    // "View all orders" restores membership, not presentation: resetting the
    // operator's chosen column sort would be a second, unasked-for change.
    const url = new URL(page.url());
    expect(url.searchParams.get('createdFrom')).toBeNull();
    expect(url.searchParams.get('sort')).toBe('createdAt');
    expect(url.searchParams.get('dir')).toBe('asc');
  });
});
