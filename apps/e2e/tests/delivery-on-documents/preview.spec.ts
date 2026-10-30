/**
 * Order-detail sales-document preview of the delivery line (#3912, ADR-079)
 *
 * The seeded mixed Polish basket (60.00 @ 23% + 40.00 @ 5%, shipping 15.00)
 * must preview its shipping as two rate-named receipt lines whose amounts
 * follow the GROSS split (9.00 / 6.00) - the same arithmetic the document is
 * composed with. Poland routes to a (dummy) fiscal-receipt connection so the
 * panel previews receipt wording, where the rate rides in the name.
 *
 * @module tests/delivery-on-documents
 */
import { test, expect } from '../../src/fixtures/test';
import {
  DELIVERY_ORDER_IDS,
  cleanupDeliveryOnDocuments,
  goodsDeliverySettings,
  routePolandToDummyReceipt,
  seedDeliveryOnDocuments,
  setSourceDeliveryConfig,
} from '../../src/support/delivery-on-documents-seed';

const DELIVERY_NAME = 'Koszt dostawy';

test.beforeAll(async ({ api }) => {
  await seedDeliveryOnDocuments();
  await routePolandToDummyReceipt();
  await setSourceDeliveryConfig(api, {
    countries: { PL: goodsDeliverySettings(DELIVERY_NAME) },
  });
});

test.afterAll(async () => {
  await cleanupDeliveryOnDocuments();
});

test('the order panel previews rate-named delivery lines with the gross-based split', async ({
  page,
}) => {
  await page.goto(`/orders/${DELIVERY_ORDER_IDS.plMixed}`);
  const panel = page.locator('.sales-document-panel');
  await expect(panel).toBeVisible({ timeout: 30_000 });

  const preview = panel.locator('.panel-copy', { hasText: 'Shipping is split across the rates' });
  await expect(preview).toBeVisible();
  // `formatAmount` is locale-dependent (9,00 vs 9.00), so accept either separator.
  await expect(preview).toContainText(new RegExp(`${DELIVERY_NAME} 23%: .*9[.,]00.* at 23%`));
  await expect(preview).toContainText(new RegExp(`${DELIVERY_NAME} 5%: .*6[.,]00.* at 5%`));
});
