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
 * THREE THINGS STATED HERE rather than discovered in a failure:
 *
 * 1. The source is PrestaShop, not Allegro. An Allegro sandbox order needs a
 *    human to buy something, so it cannot be driven unattended. The document
 *    path is source-neutral - `OrderSyncService` fans out to a destination the
 *    same way whatever the order came from - so this proves the mechanism, not
 *    specifically "an order from Allegro".
 *
 * 2. The sale is priced BELOW the catalogue figure, deliberately. Priced at
 *    list price, every amount assertion here passes whether the ZK carried the
 *    buyer's price or looked one up in Subiekt, because the two numbers are
 *    equal - so the amount tests would prove nothing about promise 4. The
 *    fixture charges 61% instead, and asserts the gap is real before asserting
 *    Subiekt honoured it.
 *
 * 3. Stock moves ONLY for a line whose product resolves to a Subiekt towar
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
import { waitForDocument } from '../../src/support/subiekt-documents';
import type { ApiClient } from '../../src/api/api-client';
import type { OrderRecord, Product } from '../../src/api/api.types';
import { PlatformType } from '../../src/world/world';
import { synthesizeOrder, buildPrestashopWebserviceClient } from '../../src/support/order-synthesis';
import { ensureSubiektProductOnShop } from '../../src/support/subiekt-shop-driver';
import { buildSubiektBridgeClient } from '../../src/api/subiekt-bridge';

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
): Promise<{ status: string; error: string | null } | null> {
  const deadline = Date.now() + timeoutMs;
  let last: { status: string; error: string | null } | null = null;
  while (Date.now() < deadline) {
    const order: OrderRecord = await api.orders.getById(internalOrderId);
    const row = order.syncStatus.find((s) => s.destinationConnectionId === destinationConnectionId);
    if (row) {
      last = { status: row.status, error: row.error };
      if (row.status !== 'pending' && row.status !== 'syncing') return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  return last;
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
  /**
   * What the buyer was actually charged, read off the ingested order, and what
   * the catalogue says the same variant costs. Held apart on purpose: the ZK test below asserts BOTH that
   * Subiekt recorded the first figure and that the two genuinely differ, so it
   * cannot pass by a catalogue lookup happening to return the right number.
   */
  let soldUnitPriceGross: number | null = null;
  let catalogueUnitPriceGross: number | null = null;
  /**
   * Set when the source reports net line prices AND no gross figure at all,
   * which is still refused.
   *
   * **This used to be true of PrestaShop and is not any more (#3365).** The
   * refusal was written as a hard product fact - a shop pricing net could
   * never send an order to Subiekt - on the premise that such a shop reports
   * nothing gross. PrestaShop reports `unit_price_tax_incl` on every order row
   * and the mapper simply discarded it; it is carried now, so a synthesised
   * PrestaShop order reaches the ZK and the document tests below RUN rather
   * than skip. That is the point of this whole file.
   *
   * The refusal branch is kept because it is still reachable, by a source that
   * genuinely reports neither a gross line price nor gross shipping. When it
   * fires it is ASSERTED rather than worked around, and the two tests after it
   * skip naming it - a skip that states a real constraint beats a green test
   * that exercised nothing.
   */
  let sourceIsNetPriced = false;

  test('an order reaches Subiekt as a ZK, or is refused for a stated reason', async ({ api, world, jobs, poll, env }, testInfo) => {
    test.skip(!env.testSubiekt, 'opt-in — set E2E_TEST_SUBIEKT=true against a live Subiekt GT bridge');
    const subiekt = world.connectionFor(PlatformType.subiektGt);
    test.skip(!subiekt, 'no Subiekt GT connection on this stack');
    test.skip(
      buildPrestashopWebserviceClient(world) === null,
      'no PrestaShop webservice credentials — set OL_PS_WEBSERVICE_KEY to mint a real order',
    );

    // Sell a towar SUBIEKT KNOWS, not merely one the shop carries (#3365
    // audit). `pickDriverProduct` inside the synthesiser requires only a
    // PrestaShop mapping, and on a real stack that is a shop-native product
    // Subiekt has never seen - the order then reaches the Subiekt destination
    // and is refused there with "the product must be synced from this Subiekt
    // connection (ProductMaster) before an order referencing it can be created
    // here", which is how this test failed against a perfectly healthy bridge.
    const publishConnection = world
      .connectionsFor(PlatformType.prestashop)
      .find((c) => c.status === 'active' && c.enabledCapabilities.includes('ProductPublisher'));
    test.skip(
      !publishConnection,
      `no ACTIVE PrestaShop connection has ProductPublisher enabled, so no Subiekt towar can be ` +
        `put on the shop to sell. enabledCapabilities is stamped at create and never ` +
        `retro-filled (#2085), so enable it on the store.`,
    );
    const shopDriver = await ensureSubiektProductOnShop(
      api,
      buildPrestashopWebserviceClient(world)!,
      subiekt!.id,
      publishConnection!,
    );
    test.skip(
      shopDriver === null,
      'no catalogue product carries a Subiekt mapping AND a priced, SKU-bearing variant. Run ' +
        'the Subiekt ProductMaster sweep first.',
    );

    // PRICE THE SALE BELOW THE CATALOGUE, which is what makes promise 4
    // ("the real sale price from the marketplace") askable at all (#3365).
    //
    // Priced at the catalogue figure, every downstream amount assertion passes
    // whether the ZK carried the buyer's price or looked one up in Subiekt -
    // the two numbers are equal, so the test proves nothing about which of them
    // was used. A real marketplace sale almost never matches the catalogue: a
    // coupon, a campaign price or a marketplace-funded discount all send a
    // LOWER figure, and ADR-014 is explicit that OpenLinker carries what the
    // buyer paid and never recomputes it.
    //
    // 39% off - not a half or a quarter, so a catalogue substitution cannot
    // match through an arithmetic coincidence. The reduction is applied by
    // PRESTASHOP, via a customer-scoped `specific_price`; posting a lower line
    // price alone does not survive, because the shop recomputes the cart total
    // from the catalogue and files the mismatch as "Payment error". The figure
    // that matters is therefore READ BACK off the ingested order below, never
    // predicted here.
    const cataloguePrice = shopDriver!.variant.price ?? shopDriver!.product.price ?? 0;
    expect(
      cataloguePrice,
      'the driver variant carries no positive catalogue price, so no discount can be expressed',
    ).toBeGreaterThan(0);
    catalogueUnitPriceGross = cataloguePrice;

    const synthesized = await synthesizeOrder(
      { api, world, jobs, poll },
      {
        quantity: 1,
        discountFraction: 0.39,
        driver: { product: shopDriver!.product, variant: shopDriver!.variant },
        // The shop's own id for what OpenLinker published: a `ShopProduct`
        // mapping is invisible to the products API, so the synthesiser's own
        // lookup would find nothing.
        externalProductId: shopDriver!.shopProductId,
        // Wait on the connection that PUBLISHED. Two PrestaShop connections can
        // poll one store and only this one holds the mapping that resolves the
        // line; the other ingests the same order as `awaiting_mapping`, which
        // is correct, so waiting there can only time out.
        ingestConnection: shopDriver!.publishConnection,
      },
    );
    // Which source actually ingested it - read from the order rather than
    // assumed, because two connections can poll one shop and either may win.
    const ingestedFromPrestashop =
      shopDriver!.publishConnection.id === synthesized.order.sourceConnectionId;
    internalOrderId = synthesized.order.internalOrderId;
    // What the shop ACTUALLY charged, read off the ingested order rather than
    // computed here. If PrestaShop ignored the reduction this is the catalogue
    // figure, and the assertion below says so instead of a later amount test
    // passing while proving nothing.
    const ingestedTotal = (synthesized.order.orderSnapshot as { totals?: { total?: number } })
      .totals?.total;
    expect(
      ingestedTotal,
      'the ingested order carries no total, so the sale price cannot be established',
    ).toBeTruthy();
    expect(
      ingestedTotal!,
      `the sale was supposed to be discounted 39% off a catalogue ${cataloguePrice}, and the ` +
        `ingested order carries ${ingestedTotal}. PrestaShop recomputes a cart from the ` +
        `catalogue, so an undiscounted total here means the specific_price did not apply - and ` +
        `every amount assertion downstream would then pass without proving the buyer's price ` +
        `was carried rather than looked up.`,
    ).toBeLessThan(cataloguePrice * soldQuantity);
    soldUnitPriceGross = ingestedTotal!;
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

    const reason = row!.error ?? '';
    if (row!.status === 'failed' && /net \(tax-exclusive\) line prices/i.test(reason)) {
      // The refusal must be EXPLICIT. A silently-dropped order would leave the
      // seller with a sale in the channel, nothing in Subiekt and no reason
      // anywhere - which is the failure shape this whole exercise is about.
      sourceIsNetPriced = true;
      // The sentence is composed in `libs/core` and is deliberately
      // PLATFORM-NEUTRAL (#3365) - naming Subiekt there would put a platform
      // name in the domain, which ADR-026 keeps out. So this asserts the two
      // things an operator actually needs: what could not be done, and which
      // half of the data was missing.
      expect(
        reason,
        'a refused order must say what could not be done and which gross figure was missing',
      ).toContain('cannot be recorded in the destination system');
      expect(reason, 'a refusal must name the missing figure, not merely refuse').toMatch(
        /no gross \(tax-inclusive\) (price|shipping)/i,
      );
      // A PrestaShop order reaching here is a REGRESSION, not a design
      // outcome, and it is failed rather than annotated (#3365 audit).
      //
      // The branch exists for a source that genuinely reports neither a gross
      // line price nor gross shipping. PrestaShop is not one: it reports
      // `unit_price_tax_incl` on every order row and the mapper carries it. So
      // on this path the refusal means the carrying broke somewhere between
      // the mapper and the order snapshot - and passing green here would
      // additionally skip BOTH remaining tests in this file, turning one
      // regression into a whole file that reports nothing. That is the exact
      // silence this suite exists to remove, one level up.
      expect(
        ingestedFromPrestashop,
        `PrestaShop reports a gross line price on every order row, so a refusal naming a ` +
          `missing gross figure means it was lost between the mapper and the order snapshot ` +
          `(check the snapshot allowlist first - it has lost a field twice). Refusal: ${reason}`,
      ).toBe(false);
      // PASSES rather than skips for a source that really is net-only. The
      // refusal IS the assertion there, and a skipped test reports nothing to
      // whoever reads the run - the same complaint this whole exercise makes
      // about silent behaviour. The two tests after it skip, because there is
      // genuinely no ZK to document.
      testInfo.annotations.push({
        type: 'subiekt',
        description:
          `source reports NET line prices AND no gross figure of its own, so the ZK was ` +
          `refused explicitly, as designed (ADR-014 — OpenLinker carries the buyer-paid figure ` +
          `and never recomputes tax). Since #3365 a PrestaShop order should NOT land here: it ` +
          `reports unit_price_tax_incl and the mapper carries it. Seeing this annotation on a ` +
          `PrestaShop-synthesised order means that carrying broke somewhere between the mapper ` +
          `and the order snapshot — check the snapshot allowlist first, it has lost a field twice.`,
      });
      return;
    }

    expect(
      row!.status,
      `order ${internalOrderId} failed to mirror into Subiekt: ${reason || 'no message'}`,
    ).toBe('synced');
  });

  // THE ASSERTION NO TEST IN THIS REPOSITORY HAS EVER MADE (#3365 audit).
  //
  // Everything else about promise 2 reads an OpenLinker row: a `syncStatus`
  // entry saying `synced` proves what OpenLinker BELIEVES, not that a ZK
  // exists in Subiekt with the buyer's name on it and the money the buyer
  // paid. The bridge has answered that all along - `GET /api/orders/{id}`
  // reads `dok__Dokument` and `dok_Pozycja` directly - and nothing called it.
  //
  // It also covers the two halves of promise 3 the suite could not see:
  // `grep -ri 'WZ|kontrahent' apps/e2e` returned nothing before this.
  test('the ZK exists in SUBIEKT, with the buyer and the amount they paid', async ({
    api,
    world,
    env,
  }, testInfo) => {
    test.skip(!env.testSubiekt, 'opt-in — set E2E_TEST_SUBIEKT=true');
    const subiekt = world.connectionFor(PlatformType.subiektGt);
    test.skip(!subiekt, 'no Subiekt GT connection on this stack');
    test.skip(internalOrderId === null, 'the ZK test did not produce an order');
    test.skip(sourceIsNetPriced, 'the source reports net prices, so no ZK exists to read');

    const order = await api.orders.getById(internalOrderId!);
    const row = (order.syncStatus ?? []).find((s) => s.destinationConnectionId === subiekt!.id);
    expect(row?.externalOrderId, 'OpenLinker recorded no Subiekt document id').toBeTruthy();

    const bridge = buildSubiektBridgeClient();
    if (bridge === null) {
      // ANNOTATED, never skipped: the run says exactly which claim went
      // unverified, which is the whole complaint against the old shape.
      testInfo.annotations.push({
        type: 'subiekt',
        description:
          `NOT VERIFIED IN SUBIEKT: OpenLinker recorded ZK id ${row!.externalOrderId}, but ` +
          `E2E_SUBIEKT_BRIDGE_URL / E2E_SUBIEKT_BRIDGE_TOKEN are unset so the document was not ` +
          `read back. Everything asserted here is OpenLinker's own record.`,
      });
      return;
    }

    const zk = await bridge.getOrder(row!.externalOrderId!);
    expect(
      zk,
      `OpenLinker recorded ZK id ${row!.externalOrderId} as synced, and Subiekt does not have it`,
    ).not.toBeNull();

    // The KONTRAHENT half of promise 3. Subiekt created or reused a contractor
    // for this sale, and the document carries their name.
    expect(
      zk!.kontrahentNazwa,
      `ZK ${zk!.numer} carries no kontrahent at all`,
    ).toBeTruthy();

    // THE MONEY. Promise 4 is "the real sale price from the marketplace", and
    // this is the only assertion anywhere that compares an amount in Subiekt
    // with what the buyer was actually charged.
    //
    // It is load-bearing because the fixture charged 61% of the catalogue
    // price. A Subiekt that priced the ZK from its own `tc_CenaBrutto1` rather
    // than from the order would land on `catalogueUnitPriceGross` and fail
    // here - the case that is invisible when the fixture pays list price. The
    // gap is asserted FIRST, so a fixture that silently stopped discounting
    // reports that rather than passing green on a test that checks nothing.
expect(
      soldUnitPriceGross,
      'the fixture recorded no sale price, so the comparison below would be vacuous',
    ).not.toBeNull();
    expect(
      soldUnitPriceGross!,
      `the order carries ${soldUnitPriceGross} against a catalogue ` +
        `${catalogueUnitPriceGross}. Without a gap this test cannot tell a carried price from ` +
        `a looked-up one, so it is failed rather than passed on a vacuous comparison.`,
    ).toBeLessThan(catalogueUnitPriceGross!);

    const snapshot = order.orderSnapshot as { totals?: { total?: number } };
    const buyerPaid = snapshot.totals?.total;
    expect(buyerPaid, 'the order snapshot carries no total to compare against').toBeTruthy();
    expect(
      Math.round(zk!.wartoscBrutto * 100),
      `ZK ${zk!.numer} is written for ${zk!.wartoscBrutto} ${zk!.waluta} while the buyer paid ` +
        `${buyerPaid}. A difference here is the ERP recording a different sale than happened.`,
    ).toBe(Math.round(buyerPaid! * 100));

    expect(zk!.lines.length, `ZK ${zk!.numer} has no positions`).toBeGreaterThan(0);
    testInfo.annotations.push({
      type: 'subiekt',
      description:
        `verified in Subiekt: ${zk!.numer}, kontrahent "${zk!.kontrahentNazwa}", ` +
        `${zk!.wartoscBrutto} ${zk!.waluta}, ${zk!.lines.length} position(s). The buyer paid ` +
        `${soldUnitPriceGross} against a catalogue ${catalogueUnitPriceGross}, so the ZK ` +
        `carried the buyer's price rather than the catalogue's.`,
    });
  });

  test('the sale becomes a document on the Subiekt connection', async ({ api, world, env }, testInfo) => {
    test.skip(!env.testSubiekt, 'opt-in — set E2E_TEST_SUBIEKT=true');
    const subiekt = world.connectionFor(PlatformType.subiektGt);
    test.skip(!subiekt, 'no Subiekt GT connection on this stack');
    test.skip(internalOrderId === null, 'the ZK test did not produce an order');
    test.skip(sourceIsNetPriced, 'the source reports net prices, so no ZK exists to document');

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

    // WHICH document, not merely "a document" (#3365 audit). The suite could
    // not tell a faktura from a paragon, so a routing rule that produced the
    // wrong kind would have passed.
    expect(
      ['invoice', 'receipt'],
      `document kind for ${internalOrderId} is ${record.documentType}`,
    ).toContain(record.documentType);

    // THE WAREHOUSE RELEASE - the third thing promise 3 names, and the one no
    // assertion in this suite ever touched. It was inferred from a stock drop,
    // which cannot tell a real WZ apart from the invoice carrying the movement
    // itself. The four-state answer is persisted now, and only one of them is
    // the alarm: `not-released` means the client is billed and the goods have
    // not left.
    const release = record as unknown as {
      warehouseReleaseOutcome?: string | null;
      warehouseReleaseNumber?: string | null;
    };
    expect(
      release.warehouseReleaseOutcome,
      `the goods this document billed for were reported as NOT released from the warehouse ` +
        `(order ${internalOrderId}). The client is billed and the stock has not moved.`,
    ).not.toBe('not-released');
    testInfo.annotations.push({
      type: 'subiekt',
      description:
        `warehouse release: ${release.warehouseReleaseOutcome ?? 'not reported by this provider'}` +
        (release.warehouseReleaseNumber ? ` (${release.warehouseReleaseNumber})` : ''),
    });

    // ASK SUBIEKT, rather than re-reading what OpenLinker wrote down (#3365).
    //
    // Everything above this point is OpenLinker's own record of the release:
    // the outcome and the number are fields it persisted from the bridge's
    // issue response, so asserting them proves the value was written down, not
    // that the document exists. The bridge grew a read for exactly this, and
    // without it the WZ was the one artefact of the three-document promise
    // (kontrahent, faktura or paragon, wydanie magazynowe) that was confirmed
    // only indirectly - inferred from a stock drop, which cannot tell a real WZ
    // apart from the invoice carrying the movement itself.
    const bridgeForWz = buildSubiektBridgeClient();
    if (bridgeForWz === null) {
      // ANNOTATED, never skipped - the same shape the ZK readback uses, and for
      // the same reason: the run must say which claim went unverified.
      testInfo.annotations.push({
        type: 'subiekt',
        description:
          `NOT VERIFIED IN SUBIEKT: OpenLinker recorded ` +
          `${release.warehouseReleaseNumber ?? 'no WZ number'}, but the bridge env vars are ` +
          `unset so the document was not read back.`,
      });
    } else if (release.warehouseReleaseOutcome === 'released') {
      expect(
        release.warehouseReleaseNumber,
        'OpenLinker reports the stock was released but recorded no WZ number, so nothing ' +
          'identifies the document to look up',
      ).toBeTruthy();

      const wz = await bridgeForWz.getWarehouseRelease(release.warehouseReleaseNumber!);
      expect(
        wz,
        `OpenLinker recorded warehouse release ${release.warehouseReleaseNumber}, and Subiekt ` +
          `holds no document under that number. The client is billed for goods whose release ` +
          `exists only in OpenLinker's own record.`,
      ).not.toBeNull();

      // A WZ can be a row and still release nothing: the bridge's own
      // `EnsureWarehouseRelease` records hitting exactly that, where the
      // document was linked to the ZK without its specification being copied
      // onto it. Existence alone would pass over that.
      expect(
        wz!.carriesStockMovement,
        `${wz!.numer} exists in Subiekt but is not a stock movement, so it released nothing`,
      ).toBe(true);
      expect(
        wz!.positionCount,
        `${wz!.numer} exists and carries no positions, so it took nothing off the shelf`,
      ).toBeGreaterThan(0);

      testInfo.annotations.push({
        type: 'subiekt',
        description:
          `VERIFIED IN SUBIEKT: ${wz!.numer} (id ${wz!.id}, magazyn ${wz!.magazynId ?? '?'}, ` +
          `${wz!.positionCount} position(s))`,
      });
    }
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
    test.skip(sourceIsNetPriced, 'the source reports net prices, so no document released any stock');

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

    // Re-read THIS towar, not the whole catalogue - the same trap as in
    // `published-product-order.spec.ts` (#3365 audit).
    // `master.inventory.syncAll` is budgeted and cursor-resumed (#2219), so it
    // enqueues a page of children from wherever the cursor sits, and
    // `triggerAndWait` waits for the parent that did the enqueuing. The sold
    // towar may not be read at all in that tick.
    await jobs.triggerAndWait({
      connectionId: subiekt!.id,
      jobType: 'master.inventory.syncByExternalId',
      payload: { objectType: 'Product', externalId: symbol! },
    });

    // Polled: the per-product sync writes `inventory_items`, and the
    // availability read is a separate query that can observe it a beat later.
    const deadline = Date.now() + 90_000;
    let afterAvailable: number | null = null;
    for (;;) {
      const after = await api.inventory.availability([soldVariantId!]);
      afterAvailable = after[0]?.totalAvailable ?? null;
      if (afterAvailable !== null && afterAvailable <= beforeAvailable - soldQuantity) break;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }

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
