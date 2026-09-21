/**
 * Order detail: the buyer tax ID three-state field (#3180)
 *
 * `OrderBuyerTaxIdValue`
 * (`apps/web/src/features/orders/components/order-buyer-tax-id-value.tsx`)
 * renders `order.buyerTaxId` as one of THREE distinct renderings, each
 * carrying its own `data-testid` — confirmed by reading the component rather
 * than guessed:
 *   - `order-buyer-tax-id`         — the source asserted a real value
 *   - `order-buyer-tax-id-none`    — the source positively asserted "no tax id"
 *   - `order-buyer-tax-id-unknown` — the source asserted nothing (also the
 *     `OL_STORE_PII=false` degraded reading), with a hover tooltip explaining
 *     the ambiguity
 *
 * It is mounted on `order-detail-page.tsx`'s Summary `KeyValueList` under the
 * label "Buyer tax ID" — a SEPARATE row from the `sales-document-panel`
 * (already covered exhaustively by
 * `tests/sales-documents/order-detail-panel.spec.ts`).
 *
 * The wire encoding is `order_records."buyerTaxId"`: `NULL` = not asserted,
 * `''` (empty string) = asserted-none, any other string = the id verbatim
 * (`decodeBuyerTaxIdColumn`, `libs/core/src/orders/domain/types/buyer-tax-id.types.ts`).
 * `GET /orders/:internalOrderId` includes the field (`orders.controller.ts`);
 * the list read deliberately omits it, so this state is reachable only from
 * the detail page.
 *
 * FIXTURE DATA: no existing seed produces all three states on one order set,
 * and no HTTP write path lets an operator assert "the buyer has no tax id" —
 * every order-source adapter only ever supplies a value or omits the field
 * entirely (per `docs/architecture-overview.md` § Sales Documents, "None
 * asserts it unconditionally"). This spec therefore writes three minimal
 * `order_records` rows directly, mirroring
 * `src/support/sales-document-seed.ts`'s own DB-seed exception and its
 * `assertSeedableDatabase` guard — reusing THAT module's already-seeded
 * `ksef` connection as `sourceConnectionId` rather than minting a fourth
 * connection.
 *
 * @module tests/orders
 */
import { Client } from 'pg';
import { test, expect } from '../../src/fixtures/test';
import { resolveEnv } from '../../src/config/env';
import { assertSeedableDatabase } from '../../src/support/assert-seedable-database';
import {
  seedSalesDocumentStates,
  SEED_CONNECTION_IDS,
} from '../../src/support/sales-document-seed';

const ORDER_IDS = {
  present: 'ol_order_e2e3180buyertaxidpresent00',
  none: 'ol_order_e2e3180buyertaxidnone00000',
  unknown: 'ol_order_e2e3180buyertaxidunknown00',
} as const;

const TAX_ID_VALUE = 'DE123456789';

function minimalSnapshot(customerName: string): string {
  return JSON.stringify({
    customer: { name: customerName },
    shippingAddress: { country: 'DE', city: 'Berlin' },
    channel: 'allegro',
  });
}

/**
 * Writes the three `order_records` rows this suite reads, keyed on the
 * `"buyerTaxId"` column's three encodings. Idempotent (fixed ids, delete
 * before insert) and reuses `seedSalesDocumentStates`'s `ksef` connection so
 * this module needs no connection-creation logic of its own.
 */
async function seedBuyerTaxIdStates(): Promise<void> {
  assertSeedableDatabase('seedBuyerTaxIdStates');
  await seedSalesDocumentStates();

  const env = resolveEnv();
  const client = new Client({ connectionString: env.databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    const orderIds = Object.values(ORDER_IDS);
    await client.query(`DELETE FROM order_records WHERE "internalOrderId" = ANY($1::text[])`, [
      orderIds,
    ]);

    await client.query(
      `INSERT INTO order_records
         ("internalOrderId", "sourceConnectionId", "orderSnapshot", "recordStatus", "placedAt", "currency", "totalAmount", "buyerTaxId", "createdAt", "updatedAt")
       VALUES
         ($1, $4, $5::jsonb, 'ready', now(), 'EUR', 10.0, $8, now(), now()),
         ($2, $4, $6::jsonb, 'ready', now(), 'EUR', 10.0, $9, now(), now()),
         ($3, $4, $7::jsonb, 'ready', now(), 'EUR', 10.0, NULL, now(), now())`,
      [
        ORDER_IDS.present,
        ORDER_IDS.none,
        ORDER_IDS.unknown,
        SEED_CONNECTION_IDS.ksef,
        minimalSnapshot('Present Buyer'),
        minimalSnapshot('None Buyer'),
        minimalSnapshot('Unknown Buyer'),
        TAX_ID_VALUE,
        '',
      ],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

test.describe('order detail: buyer tax ID three-state field (#3180)', () => {
  test.beforeAll(async () => {
    await seedBuyerTaxIdStates();
  });

  test('a real tax id is rendered verbatim', async ({ page }) => {
    await page.goto(`/orders/${ORDER_IDS.present}`);
    const el = page.getByTestId('order-buyer-tax-id');
    await expect(el).toBeVisible();
    await expect(el).toHaveText(TAX_ID_VALUE);
    await expect(page.getByTestId('order-buyer-tax-id-none')).toHaveCount(0);
    await expect(page.getByTestId('order-buyer-tax-id-unknown')).toHaveCount(0);
  });

  test('a positively-asserted absence renders the distinct "none" pill, never the value pill', async ({
    page,
  }) => {
    await page.goto(`/orders/${ORDER_IDS.none}`);
    const el = page.getByTestId('order-buyer-tax-id-none');
    await expect(el).toBeVisible();
    await expect(el).toHaveText('None — asserted');
    await expect(page.getByTestId('order-buyer-tax-id')).toHaveCount(0);
    await expect(page.getByTestId('order-buyer-tax-id-unknown')).toHaveCount(0);
  });

  test('an unasserted tax id renders the muted "not asserted" copy, with a PII-mode tooltip', async ({
    page,
  }) => {
    await page.goto(`/orders/${ORDER_IDS.unknown}`);
    const el = page.getByTestId('order-buyer-tax-id-unknown');
    await expect(el).toBeVisible();
    await expect(el).toHaveText('Not asserted by the source');
    await expect(page.getByTestId('order-buyer-tax-id')).toHaveCount(0);
    await expect(page.getByTestId('order-buyer-tax-id-none')).toHaveCount(0);

    // The Radix tooltip fires on hover (250ms provider delay). Best-effort:
    // this is the one assertion in this suite not previously exercised by
    // any e2e spec via `.hover()` against a live stack, so it is flagged in
    // the task report rather than assumed reliable.
    await el.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible({ timeout: 5_000 });
    await expect(tooltip).toContainText('OL_STORE_PII=false');
    await expect(tooltip).toContainText('simplified invoice can never issue');
  });
});
