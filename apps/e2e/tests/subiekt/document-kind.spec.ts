/**
 * Subiekt GT: WHICH document a sale gets, faktura or paragon (#3365)
 *
 * The MVP promise names three artefacts - kontrahent, "faktura lub paragon",
 * and the warehouse release. The suite could tell that A document appeared and
 * that its kind was one of the two valid ones:
 *
 *     expect(['invoice', 'receipt']).toContain(record.documentType);
 *
 * which passes whichever one arrived. So a routing rule that produced the wrong
 * kind - a paragon for a company that asked for a faktura, or a faktura for a
 * consumer who did not - was green. The decision itself had no coverage, and
 * the decision is the part with legal consequences for the seller.
 *
 * The rule is `deriveNeutralDocumentType`: a non-empty domestic tax id on the
 * buyer means `invoice` (FV), its absence means `receipt` (PA). It is NIP
 * presence, not an `isCompany` flag. This spec exercises BOTH branches through
 * the ordinary path - two real PrestaShop orders, one whose buyer address
 * carries a `vat_number` and one whose does not - and lets auto-issue decide,
 * rather than passing `documentType` to the issue API, which would test the
 * caller's override and not the derivation.
 *
 * WHAT IT PROVES:
 *   1. a buyer who asserts no tax number gets a paragon;
 *   2. a buyer who asserts one gets a faktura;
 *   3. the two answers DIFFER - the assertion that makes the first two mean
 *      something, since a build answering the same kind for every order would
 *      otherwise satisfy whichever of them happened to match.
 *
 * WHAT IT DOES NOT PROVE:
 *   - that the document Subiekt holds is of that kind. It asserts the kind
 *     OpenLinker recorded, and the number Subiekt assigned it (`FV .../PA ...`
 *     is Subiekt's own numbering, so a wrong kind would have to survive a
 *     wrong prefix), but the bridge exposes no read of a document by id that
 *     returns its type, so this stops one hop short of Subiekt itself.
 *   - anything about a foreign tax id. `readDomesticTaxId` treats an untagged
 *     value as domestic for this single-slot ERP, which is a decision this spec
 *     does not exercise.
 *
 * Opt-in like every spec in this folder: `E2E_TEST_SUBIEKT=true`, a live
 * Subiekt GT connection, PrestaShop webservice credentials. It sells twice into
 * a real shop and issues two real documents in a real Subiekt, so it never runs
 * by accident.
 *
 * @module apps/e2e/tests/subiekt
 */
import { expect, test } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';
import { synthesizeOrder, buildPrestashopWebserviceClient } from '../../src/support/order-synthesis';
import { ensureSubiektProductOnShop } from '../../src/support/subiekt-shop-driver';
import { waitForDocument } from '../../src/support/subiekt-documents';
import type { ApiClient } from '../../src/api/api-client';
import type { World } from '../../src/world/world';

/**
 * A structurally valid Polish NIP (the checksum is real, so a provider that
 * validates it accepts this one). It identifies nobody: it is the value the
 * invoicing suite already uses for the same purpose.
 */
const BUYER_NIP = '1234563218';

/** Auto-issue crosses a COM bridge to a real Subiekt; the ZK test measures ~1 min. */
const DOCUMENT_TIMEOUT_MS = 180_000;

/**
 * The sale has to be denominated in the currency the routing rules are written
 * in, and this is not a detail the test may leave to the shop's default.
 *
 * Measured on the reference stand: the shop defaults to EUR, every PL rule
 * carries its threshold in PLN, and a rule whose `buyerHasTaxId` condition
 * matches while its amount condition cannot be compared resolves
 * `threshold-currency-mismatch` - so the order is HELD with no document at all.
 * That is correct behaviour (#3189 compares currencies and never converts
 * them), and it makes the whole invoice branch unreachable in any other
 * currency. The no-NIP order does not hit it only because it matches no
 * threshold-bearing rule and falls through to the country default.
 */
const RULE_CURRENCY = 'PLN';

/**
 * The sale has to be of a towar SUBIEKT KNOWS, not merely one the shop carries.
 * The synthesiser's own driver pick requires a PrestaShop mapping alone, and on
 * a real stack that is a shop-native product Subiekt has never seen - the order
 * then reaches the Subiekt destination and is refused there, no ZK exists, and
 * no document follows. Measured: the first run of this spec failed exactly that
 * way, with `no document reached Subiekt` after three minutes.
 */
async function resolveShopDriver(api: ApiClient, world: World) {
  const publishConnection = world
    .connectionsFor(PlatformType.prestashop)
    .find((c) => c.status === 'active' && c.enabledCapabilities.includes('ProductPublisher'));
  if (!publishConnection) return null;
  const subiekt = world.connectionFor(PlatformType.subiektGt);
  if (!subiekt) return null;
  const ps = buildPrestashopWebserviceClient(world);
  if (ps === null) return null;
  const driver = await ensureSubiektProductOnShop(api, ps, subiekt.id, publishConnection);
  if (driver === null) return null;
  const currencyId = await ps.getCurrencyIdByIso(RULE_CURRENCY);
  return currencyId === null ? null : { ...driver, currencyId };
}

test.describe('Subiekt GT: which document a sale gets (#3365)', () => {
  // Serial: the third assertion compares the first two, and both sell into the
  // same shop against the same catalogue.
  test.describe.configure({ mode: 'serial' });

  let receiptKind: string | null = null;
  let invoiceKind: string | null = null;

  test('a buyer who asserts no tax number gets a receipt', async ({
    api,
    world,
    jobs,
    poll,
    env,
  }, testInfo) => {
    test.skip(!env.testSubiekt, 'opt-in — set E2E_TEST_SUBIEKT=true');
    const subiekt = world.connectionFor(PlatformType.subiektGt);
    test.skip(!subiekt, 'no Subiekt GT connection on this stack');
    test.skip(
      buildPrestashopWebserviceClient(world) === null,
      'no PrestaShop webservice credentials — set OL_PS_WEBSERVICE_KEY'
    );

    const driver = await resolveShopDriver(api, world);
    test.skip(
      driver === null,
      `no catalogue product carries a Subiekt mapping AND a priced, SKU-bearing variant, or no ` +
        `ACTIVE PrestaShop connection has ProductPublisher enabled, or the shop does not carry ` +
        `${RULE_CURRENCY}. Run the Subiekt ProductMaster sweep first.`
    );

    // No `buyerVatNumber`: the ordinary consumer order, and the DEFAULT this
    // suite has always produced. Stated rather than implied, because the whole
    // point of the sibling test is that it differs by this one field.
    const sale = await synthesizeOrder(
      { api, world, jobs, poll },
      {
        quantity: 1,
        currencyId: driver!.currencyId,
        driver: { product: driver!.product, variant: driver!.variant },
        externalProductId: driver!.shopProductId,
        ingestConnection: driver!.publishConnection,
      }
    );

    const record = await waitForDocument(
      api,
      sale.order.internalOrderId,
      subiekt!.id,
      DOCUMENT_TIMEOUT_MS
    );
    expect(
      record,
      `no document reached Subiekt for order ${sale.order.internalOrderId}. ` +
        `Auto-issue may be switched off for this connection.`
    ).not.toBeNull();
    expect(record!.status, `document is ${record!.status}, not issued`).toBe('issued');

    receiptKind = record!.documentType;
    testInfo.annotations.push({
      type: 'subiekt',
      description: `no NIP -> ${record!.documentType} ${record!.providerInvoiceNumber ?? '(no number)'}`,
    });

    expect(
      record!.documentType,
      `a buyer who asserted no tax number got a ${record!.documentType} ` +
        `(${record!.providerInvoiceNumber ?? 'no number'}). NIP presence is what selects the ` +
        `kind, and this buyer has none, so Subiekt should have written a paragon.`
    ).toBe('receipt');
  });

  test('a buyer who asserts a tax number gets an invoice', async ({
    api,
    world,
    jobs,
    poll,
    env,
  }, testInfo) => {
    test.skip(!env.testSubiekt, 'opt-in — set E2E_TEST_SUBIEKT=true');
    const subiekt = world.connectionFor(PlatformType.subiektGt);
    test.skip(!subiekt, 'no Subiekt GT connection on this stack');
    test.skip(
      buildPrestashopWebserviceClient(world) === null,
      'no PrestaShop webservice credentials — set OL_PS_WEBSERVICE_KEY'
    );

    const driver = await resolveShopDriver(api, world);
    test.skip(driver === null, 'no Subiekt-mapped product is publishable to the shop');

    // The ONE field that differs from the sibling above. It is written onto the
    // PrestaShop address, which is where the adapter reads it from - not passed
    // to the issue API, which would exercise the caller's override instead of
    // the derivation this test is about.
    const sale = await synthesizeOrder(
      { api, world, jobs, poll },
      {
        quantity: 1,
        buyerVatNumber: BUYER_NIP,
        currencyId: driver!.currencyId,
        driver: { product: driver!.product, variant: driver!.variant },
        externalProductId: driver!.shopProductId,
        ingestConnection: driver!.publishConnection,
      }
    );

    const record = await waitForDocument(
      api,
      sale.order.internalOrderId,
      subiekt!.id,
      DOCUMENT_TIMEOUT_MS
    );
    expect(
      record,
      `no document reached Subiekt for order ${sale.order.internalOrderId}`
    ).not.toBeNull();
    expect(record!.status, `document is ${record!.status}, not issued`).toBe('issued');

    invoiceKind = record!.documentType;
    testInfo.annotations.push({
      type: 'subiekt',
      description: `NIP ${BUYER_NIP} -> ${record!.documentType} ${record!.providerInvoiceNumber ?? '(no number)'}`,
    });

    expect(
      record!.documentType,
      `a buyer who asserted NIP ${BUYER_NIP} got a ${record!.documentType} ` +
        `(${record!.providerInvoiceNumber ?? 'no number'}). A company that gave its tax number ` +
        `is owed a faktura, and a paragon does not substitute for one.`
    ).toBe('invoice');
  });

  test('the two orders got DIFFERENT kinds', ({ env }) => {
    test.skip(!env.testSubiekt, 'opt-in — set E2E_TEST_SUBIEKT=true');
    test.skip(
      receiptKind === null || invoiceKind === null,
      'one of the two document tests did not produce a document'
    );

    // The assertion that makes the other two mean something. Each of them on
    // its own is satisfiable by a build that answers one kind for every order:
    // such a build passes whichever test matches its constant and fails the
    // other, which reads as one broken case rather than as a decision that is
    // not being made at all. Comparing them names it.
    expect(
      receiptKind,
      `both orders got ${receiptKind}. The kind is not being decided from the buyer's tax ` +
        `number at all - it is the same answer whatever the order carries.`
    ).not.toBe(invoiceKind);
  });
});

/**
 * The same decision, on the channel the seller actually sells through.
 *
 * The block above drives it through PrestaShop, where the tax number is a field
 * on the buyer's address and a test can set it. Allegro carries it by a
 * different route entirely - the buyer requests a VAT invoice at checkout and
 * Allegro reports the number on the order - and no test can produce either kind
 * of Allegro order, because a sandbox purchase is a human act. So this block
 * OBSERVES what the stack already carries rather than creating it, the same
 * posture `shipping/auto-dispatch-notify.spec.ts` takes towards the marketplace
 * readback for the same reason.
 *
 * Verified by hand on the reference stand while this was written, with two real
 * sandbox purchases: the one carrying NIP 7393983663 produced FS 48/2026 with
 * warehouse release WZ 96/2026, and the one carrying none produced PA 90/2026
 * with WZ 103/2026. Both releases were then confirmed inside Subiekt itself.
 * This block is what keeps that from being a one-off observation.
 */
test.describe('Subiekt GT: the same decision on a real Allegro sale (#3365)', () => {
  /** Bounded like `findAllegroShipment`: a scan, not a full history read. */
  const SCAN_LIMIT = 25;

  test('every observed Allegro sale got the kind its tax number implies', async ({
    api,
    world,
    env,
  }, testInfo) => {
    test.skip(!env.testSubiekt, 'opt-in — set E2E_TEST_SUBIEKT=true');
    const subiekt = world.connectionFor(PlatformType.subiektGt);
    test.skip(!subiekt, 'no Subiekt GT connection on this stack');
    const allegro = world.connectionFor(PlatformType.allegro);
    test.skip(!allegro, 'no Allegro connection on this stack');

    const orders = await api.orders.list({ sourceConnectionId: allegro!.id, limit: SCAN_LIMIT });

    const withTaxId: { order: string; kind: string; number: string | null }[] = [];
    const withoutTaxId: { order: string; kind: string; number: string | null }[] = [];

    for (const listed of orders.items) {
      // The list projection does not carry the tax number, so the detail is
      // read per candidate. Bounded by SCAN_LIMIT above.
      const order = await api.orders.getById(listed.internalOrderId);
      let record;
      try {
        record = await api.invoices.getForOrder(listed.internalOrderId, subiekt!.id);
      } catch {
        continue; // no document on this connection - nothing to judge
      }
      if (!record || record.status !== 'issued') continue;

      // A non-empty value is the only state that means "the buyer gave a tax
      // number". Absent and `''` are different facts about the SOURCE - it said
      // nothing, versus it said there is none - but the rule under test treats
      // both as no number, exactly as `readDomesticTaxId` does.
      const hasTaxId = typeof order.buyerTaxId === 'string' && order.buyerTaxId.length > 0;
      const entry = {
        order: listed.internalOrderId,
        kind: record.documentType,
        number: record.providerInvoiceNumber,
      };
      (hasTaxId ? withTaxId : withoutTaxId).push(entry);
    }

    testInfo.annotations.push({
      type: 'subiekt',
      description:
        `observed ${withTaxId.length} Allegro sale(s) with a tax number and ` +
        `${withoutTaxId.length} without, out of the last ${SCAN_LIMIT}`,
    });

    // Skipped LOUDLY and separately, naming which half is missing: the two need
    // different purchases, so one message covering both would not tell an
    // operator what to do.
    test.skip(
      withTaxId.length === 0,
      `no Allegro sale in the last ${SCAN_LIMIT} orders carries a buyer tax number AND an ` +
        `issued Subiekt document. Buy one in the sandbox requesting a VAT invoice.`
    );
    test.skip(
      withoutTaxId.length === 0,
      `no Allegro sale in the last ${SCAN_LIMIT} orders is without a buyer tax number AND has ` +
        `an issued Subiekt document. Buy an ordinary one in the sandbox.`
    );

    const wrongInvoice = withTaxId.filter((e) => e.kind !== 'invoice');
    expect(
      wrongInvoice,
      `these Allegro buyers gave a tax number and were issued something other than a faktura: ` +
        `${wrongInvoice.map((e) => `${e.order} -> ${e.kind} ${e.number ?? ''}`).join('; ')}`
    ).toEqual([]);

    const wrongReceipt = withoutTaxId.filter((e) => e.kind !== 'receipt');
    expect(
      wrongReceipt,
      `these Allegro buyers gave no tax number and were issued something other than a paragon: ` +
        `${wrongReceipt.map((e) => `${e.order} -> ${e.kind} ${e.number ?? ''}`).join('; ')}`
    ).toEqual([]);
  });
});
