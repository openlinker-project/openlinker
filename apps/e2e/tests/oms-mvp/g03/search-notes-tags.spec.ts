/**
 * G03 golden path 1 — search, note, tag, tag filter (#3536)
 *
 * Search an order by SKU and by tracking number, open it, add an internal
 * note flagged "Show to packer" and a tag, return to `/orders` and filter by
 * that tag (count agrees with rows), then as a packer on `/bench` confirm
 * the flagged note is visible and the tag is not (D12).
 *
 * Seeding note: this suite locates an ALREADY-INGESTED order + its first
 * line's SKU from the stack (`world`/`api`) rather than synthesizing a fresh
 * one — synthesizing an order with a dispatched shipment (for the
 * tracking-number half) needs the full label-generation pipeline, which is
 * out of this epic's scope to stand up. `test.skip` names the precondition
 * when the seeded stack carries neither.
 *
 * @module tests/oms-mvp/g03
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../../../src/fixtures/test';
import { provisionPacker, seedPackerBrowserSession } from '../../../src/support/provision-packer';

/**
 * The order row's identity cell (`OrderIdentityCell` → `EntityLabel`) renders
 * its `<Link>`'s VISIBLE text from the source order number (shortened past 18
 * chars) or, absent one, a heavily-truncated id — never the raw internal id.
 * `internalOrderId.slice(-6)` therefore never appears in the link's accessible
 * name and `getByRole('link', { name: … })` can never match it (confirmed by
 * source inspection, #3536 review). The link's `href` carries the untruncated
 * `/orders/{internalOrderId}` regardless of what is displayed, so select the
 * row by that instead — exact, and immune to display-formatting changes.
 */
function orderRowLink(page: Page, internalOrderId: string) {
  return page.locator(`a[href="/orders/${internalOrderId}"]`);
}

test.describe('G03 golden path 1 — search / notes / tags (#3536)', () => {
  test('search by SKU and tracking number, add a flagged note and a tag, filter by tag, verify on /bench', async ({
    page,
    api,
    env,
    poll,
  }) => {
    // 1. Find an order with at least one named line item's SKU — the search
    //    bar's "SKU" axis (#3527).
    const candidates = await api.orders.list({ limit: 25, offset: 0 });
    const withSku = candidates.items.find((o) =>
      Array.isArray((o.orderSnapshot as { items?: unknown[] } | undefined)?.items),
    );
    test.skip(!withSku, 'No seeded order with a resolvable line item found on this stack.');
    const order = withSku!;
    const sku = (order.orderSnapshot as { items: { sku?: string }[] }).items.find((i) => i.sku)?.sku;
    test.skip(!sku, 'No seeded order line carries a SKU.');

    await page.goto('/orders');
    const search = page.getByPlaceholder('Search order #, buyer, SKU, tracking…');
    await search.fill(sku!);
    // #3529 — 300 ms debounce before the request fires.
    await page.waitForTimeout(400);
    await expect(orderRowLink(page, order.internalOrderId)).toBeVisible();

    // Tracking-number search (#3528) — best-effort: only asserted when this
    // order actually has a dispatched shipment to search for.
    const activeShipment = await api.shipments.active(order.internalOrderId);
    const trackingNumber = activeShipment?.trackingNumber;
    if (trackingNumber) {
      await search.fill('');
      await search.fill(trackingNumber);
      await page.waitForTimeout(400);
      await expect(orderRowLink(page, order.internalOrderId)).toBeVisible();
    }

    // 2. Open the order, add a packer-visible note and a tag.
    await search.fill('');
    await page.goto(`/orders/${order.internalOrderId}`);
    const noteBody = `E2E flagged note ${Date.now()}`;
    await page.getByPlaceholder('Add an internal note…').fill(noteBody);
    await page.getByLabel('Show to packer').check();
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.getByText(noteBody)).toBeVisible();

    const tagName = `E2E-${Date.now()}`;
    await page.getByRole('button', { name: '+ Add tag' }).click();
    await page.getByPlaceholder('Search or create a tag').fill(tagName);
    await page.getByRole('button', { name: 'Create & add' }).click();
    await expect(page.getByText(tagName)).toBeVisible();

    // 3. Back on /orders, filter by the new tag — the count agrees with the rows.
    await page.goto('/orders');
    await page.getByLabel('Filter by tag').selectOption({ label: tagName });
    await poll.until(
      () => page.getByRole('row').count(),
      (count) => count >= 2, // header + >=1 data row
      { message: 'the tag-filtered orders list to render at least one row' },
    );
    await expect(orderRowLink(page, order.internalOrderId)).toBeVisible();

    // 4. As a packer on /bench: the flagged note is visible, the tag is not (D12).
    const packer = await provisionPacker(env, api);
    test.skip(packer === null, 'Could not provision a packer account on this stack.');
    await seedPackerBrowserSession(page.context(), env, packer!.creds);
    await page.goto('/bench');
    await expect(page.getByText(noteBody)).toBeVisible();
    await expect(page.getByText(tagName)).toHaveCount(0);
  });
});
