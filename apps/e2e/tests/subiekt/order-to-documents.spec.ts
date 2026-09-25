/**
 * Subiekt GT: an order becomes documents, and documents move stock (#3365)
 *
 * The gap this fills is blunt: before it, NOT ONE spec in this repository
 * asserted that a document was ever created in Subiekt. `libs/integrations/
 * subiekt` ships four order/document capabilities - `OrderProcessorManager`,
 * `Invoicing`, `Fiscalization`, `OrderSource` - with no end-to-end coverage at
 * all, and the promise the product makes about them is the one an operator
 * feels first: a sale arrives, a document exists, the stock drops.
 *
 * Shape borrowed from `golden-path/full-flow/09-s7-prestashop-orders.spec.ts`:
 * an order is minted at a real source, ingested by OpenLinker, and then
 * asserted on the DESTINATION side through the same `syncStatus` poll.
 *
 * TWO HONEST LIMITS, both stated here rather than discovered in a failure:
 *
 * 1. The source is PrestaShop, not Allegro. An Allegro sandbox order needs a
 *    human to buy something, so it cannot be driven unattended. The document
 *    path is source-neutral - `OrderSyncService` fans out to a destination the
 *    same way whatever the order came from - so this proves the mechanism, not
 *    specifically "an order from Allegro".
 *
 * 2. Stock moves ONLY for a line whose product resolves to a Subiekt towar
 *    symbol. `subiekt-line.mapper.ts` degrades an unresolved product to
 *    `DodajUslugeJednorazowa` - a one-off SERVICE position that Subiekt stores
 *    with `ob_TowId = NULL` and that no warehouse document can release. That
 *    is correct (a delivery charge is not a catalogue item) and it is also the
 *    single fact an operator most needs to know, so the stock test REPORTS an
 *    unresolved line rather than skipping past it quietly.
 *
 * Opt-in, like every spec in this folder: `E2E_TEST_SUBIEKT=true` plus a live
 * Subiekt GT connection on the stack. It creates a real order and a real
 * fiscal document in a real Subiekt install, so it never runs by accident.
 *
 * @module apps/e2e/tests/subiekt
 */
import { expect, test } from '../../src/fixtures/test';
import type { ApiClient } from '../../src/api/api-client';
import type { InvoiceRecord, OrderRecord, Product } from '../../src/api/api.types';
import { PlatformType } from '../../src/world/world';
import { synthesizeOrder, buildPrestashopWebserviceClient } from '../../src/support/order-synthesis';

/** How long a destination fan-out and an auto-issue may take on a shared stack. */
const DESTINATION_TIMEOUT_MS = 180_000;
const DOCUMENT_TIMEOUT_MS = 180_000;

/**
 * Poll until the order carries a terminal `syncStatus` row for this
 * destination, then report it.
 *
 * Returns the row rather than asserting, because "failed" is a result this
 * spec must be able to report WITH the destination's own message - a bare
 * timeout would hide the reason the mirror failed, which is the only thing
 * that makes the failure actionable.
 */
async function waitForDestinationRow(
  api: ApiClient,
  internalOrderId: string,
  destinationConnectionId: string,
  timeoutMs: number,
): Promise<{ status: string; message?: string | null } | null> {
  const deadline = Date.now() + timeoutMs;
  let last: { status: string; message?: string | null } | null = null;
  while (Date.now() < deadline) {
    const order: OrderRecord = await api.orders.getById(internalOrderId);
    const row = order.syncStatus.find((s) => s.destinationConnectionId === destinationConnectionId);
    if (row) {
      last = { status: row.status, message: (row as { message?: string | null }).message ?? null };
      if (row.status !== 'pending' && row.status !== 'syncing') return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  return last;
}

/** Poll for the order's document on ONE connection; `null` when none appears. */
async function waitForDocument(
  api: ApiClient,
  internalOrderId: string,
  connectionId: string,
  timeoutMs: number,
): Promise<InvoiceRecord | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const record = await api.invoices.getForOrder(internalOrderId, connectionId);
      // A `pending` row is an attempt in flight, not an answer. Keep waiting.
      if (record && record.status !== 'pending') return record;
    } catch {
      // 404 until the gate fires - an expected state, not a failure.
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  return null;
}

/** The Subiekt towar symbol this product maps to, or `null` if it maps to none. */
function subiektSymbolOf(product: Product, subiektConnectionId: string): string | null {
  const match = product.externalIds?.find(
    (mapping) => mapping.connectionId === subiektConnectionId,
  );
  return match?.externalId ?? null;
}

test.describe('Subiekt GT: order to documents (#3365)', () => {
  // Serial: every test below reads the ONE order the first one mints. Creating
  // a fresh order per test would put three real orders and three real fiscal
  // documents into somebody's Subiekt for one run.
  test.describe.configure({ mode: 'serial' });

  let internalOrderId: string | null = null;
  let soldProduct: Product | null = null;
  let soldVariantId: string | null = null;
  const soldQuantity = 1;

  test('an order reaches Subiekt as a ZK', async ({ api, world, jobs, poll, env }) => {
    test.skip(!env.testSubiekt, 'opt-in — set E2E_TEST_SUBIEKT=true against a live Subiekt GT bridge');
    const subiekt = world.connectionFor(PlatformType.subiektGt);
    test.skip(!subiekt, 'no Subiekt GT connection on this stack');
    test.skip(
      buildPrestashopWebserviceClient(world) === null,
      'no PrestaShop webservice credentials — set OL_PS_WEBSERVICE_KEY to mint a real order',
    );

    const synthesized = await synthesizeOrder({ api, world, jobs, poll }, { quantity: 1 });
    internalOrderId = synthesized.order.internalOrderId;
    soldProduct = synthesized.product;
    soldVariantId = synthesized.variant.id;

    const row = await waitForDestinationRow(
      api,
      internalOrderId,
      subiekt!.id,
      DESTINATION_TIMEOUT_MS,
    );

    expect(
      row,
      `order ${internalOrderId} never got a syncStatus row for the Subiekt connection — the ` +
        `destination fan-out did not reach it (check OrderProcessorManager is enabled)`,
    ).not.toBeNull();
    expect(
      row!.status,
      `order ${internalOrderId} failed to mirror into Subiekt: ${row!.message ?? 'no message'}`,
    ).toBe('synced');
  });

  test('the sale becomes a document on the Subiekt connection', async ({ api, world, env }) => {
    test.skip(!env.testSubiekt, 'opt-in — set E2E_TEST_SUBIEKT=true');
    const subiekt = world.connectionFor(PlatformType.subiektGt);
    test.skip(!subiekt, 'no Subiekt GT connection on this stack');
    test.skip(internalOrderId === null, 'the ZK test did not produce an order');

    const record = await waitForDocument(api, internalOrderId!, subiekt!.id, DOCUMENT_TIMEOUT_MS);

    if (record === null) {
      // The reason is PERSISTED on the order (#2100/#3365), so a missing
      // document is explained rather than merely absent. Reading it here is
      // what turns "the spec timed out" into "auto-issue is switched off, and
      // here is the knob".
      const order = await api.orders.getById(internalOrderId!);
      const blocked = order as unknown as {
        salesDocumentBlockReason?: string | null;
        salesDocumentUnresolvedReason?: string | null;
        salesDocumentBlockDetail?: string | null;
      };
      throw new Error(
        `no document reached the Subiekt connection for order ${internalOrderId}. ` +
          `Persisted reason: blockReason=${blocked.salesDocumentBlockReason ?? 'none'} ` +
          `unresolvedReason=${blocked.salesDocumentUnresolvedReason ?? 'none'} ` +
          `detail=${blocked.salesDocumentBlockDetail ?? 'none'}. ` +
          `A blank reason with no document means the gate never ran for this order.`,
      );
    }

    // `in-doubt` is its own answer and must not read as success: it means the
    // bridge may or may not have created the document, which is exactly the
    // state that must never be silently retried.
    expect(
      record.status,
      `document for ${internalOrderId} is ${record.status} ` +
        `(${(record as unknown as { failureReason?: string }).failureReason ?? 'no reason'})`,
    ).toBe('issued');
    expect(
      record.providerInvoiceNumber,
      'an issued Subiekt document carries the number Subiekt itself assigned',
    ).toBeTruthy();
  });

  // The promise is "synchronizacja stanów magazynowych": a sale in a channel
  // reduces what Subiekt says is available, and OpenLinker republishes the
  // lower figure. Nothing in this repo asserted any part of that chain.
  test('an issued document moves the towar stock, and OpenLinker sees it', async ({
    api,
    world,
    jobs,
    env,
  }) => {
    test.skip(!env.testSubiekt, 'opt-in — set E2E_TEST_SUBIEKT=true');
    const subiekt = world.connectionFor(PlatformType.subiektGt);
    test.skip(!subiekt, 'no Subiekt GT connection on this stack');
    test.skip(internalOrderId === null || soldProduct === null, 'no order was produced');

    const symbol = subiektSymbolOf(soldProduct!, subiekt!.id);
    test.skip(
      symbol === null,
      `the sold product (${soldProduct!.name}) maps to no Subiekt towar, so its invoice line is a ` +
        `one-off SERVICE position and no warehouse document can release it. That is the mapper's ` +
        `documented degradation, not a defect — but it means stock CANNOT move for this order. ` +
        `To exercise this assertion the sold product must carry a Subiekt identifier mapping.`,
    );

    // The figure OpenLinker publishes, which is what a channel sees.
    const before = await api.inventory.availability([soldVariantId!]);
    const beforeAvailable = before[0]?.totalAvailable ?? null;
    test.skip(
      beforeAvailable === null,
      'OpenLinker holds no availability for the sold variant, so there is no figure to compare',
    );

    // Re-read the master so the mirror reflects the release the document made.
    await jobs.triggerAndWait({
      connectionId: subiekt!.id,
      jobType: 'master.inventory.syncAll',
    });

    const after = await api.inventory.availability([soldVariantId!]);
    const afterAvailable = after[0]?.totalAvailable ?? null;

    expect(
      afterAvailable,
      'availability became unknown after the sync — a null here would publish as a suppressed ' +
        'write, not as a lower number',
    ).not.toBeNull();
    expect(
      afterAvailable,
      `${symbol}: stock did not drop after the document was issued ` +
        `(${beforeAvailable} -> ${afterAvailable}). Either the invoice line resolved to a service ` +
        `position, or no warehouse release followed the document.`,
    ).toBeLessThanOrEqual(beforeAvailable - soldQuantity);
  });
});
