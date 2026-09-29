/**
 * Subiekt GT: two buyers who share a name do NOT share a kontrahent (#3365)
 *
 * Subiekt identifies a customer card by its SYMBOL, and the bridge derives that
 * symbol from the buyer's NAME - uppercased, first 16 alphanumerics. So it is
 * not an identity at all: every "Jan Kowalski" in Poland derives the same one.
 * Two unrelated buyers with no NIP and a comparable address therefore resolved
 * to ONE kontrahent, and the second one's document was billed to the first
 * one's card. Silently - the match succeeded, nothing threw, and the wrong name
 * went on the paper.
 *
 * Observed live on 2026-09-23 from the other direction, the duplicate half of
 * the same defect: kontrahent 94 `NORBERTKULUS(5)`, 95 `NORBERTKULUS(6)`.
 *
 * The fix hands the bridge OpenLinker's own customer id, which IS an identity,
 * and demotes the symbol to what it always was - a fallback for a buyer nobody
 * can identify.
 *
 * WHY THIS NEEDS NO MARKETPLACE. `synthesizeOrder` hardcodes the buyer name
 * `Erik Testowy` and the address `ul. Testowa 1, 00-001 Warszawa`, while
 * minting a UNIQUE e-mail per call - and OpenLinker's customer identity is
 * keyed on the e-mail hash. So two calls are, by construction, two different
 * OpenLinker customers with an identical name and an identical address and no
 * tax number: exactly the collision, reproducible on demand.
 *
 * WHAT IT PROVES:
 *   1. the two sales really are two different OpenLinker customers - the
 *      premise, checked rather than assumed, because a build that collapsed
 *      them into one customer would fail (3) for a reason that is not the
 *      subject of this test;
 *   2. the two ZKs carry the SAME kontrahent name - the collision is real and
 *      present, not something the fixture accidentally avoided;
 *   3. and DIFFERENT kontrahent ids. That is the fix.
 *
 * WHAT IT DOES NOT PROVE:
 *   - anything about a buyer carrying a NIP. A tax id is an identity and always
 *     was; `document-kind.spec.ts` covers that branch.
 *   - that an EXISTING card adopts the id (the backfill). That needs a card
 *     that predates the change, which a spec creating its own data cannot have.
 *     It is verified by hand against the reference stand instead.
 *
 * Opt-in like every spec in this folder: `E2E_TEST_SUBIEKT=true`, a live
 * Subiekt GT connection, PrestaShop webservice credentials, and the bridge
 * read-back credentials - without the last of these the kontrahent id cannot be
 * observed at all and the spec says so rather than passing.
 *
 * @module apps/e2e/tests/subiekt
 */
import { expect, test } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';
import { synthesizeOrder, buildPrestashopWebserviceClient } from '../../src/support/order-synthesis';
import { ensureSubiektProductOnShop } from '../../src/support/subiekt-shop-driver';
import { buildSubiektBridgeClient } from '../../src/api/subiekt-bridge';
import type { ApiClient } from '../../src/api/api-client';
import type { World } from '../../src/world/world';
import type { OrderRecord } from '../../src/api/api.types';

/** The ZK crosses a COM bridge into a real Subiekt; the sibling specs measure ~1 min. */
const ZK_TIMEOUT_MS = 180_000;

/**
 * PLN for the same reason `document-kind.spec.ts` states: the stand's shop
 * defaults to EUR while every PL routing rule carries a PLN threshold, and a
 * rule that cannot compare its amount holds the order with no document. This
 * spec stops at the ZK and never reaches issuance, so it is belt and braces -
 * but a held order is a confusing failure to debug from a kontrahent assertion.
 */
const RULE_CURRENCY = 'PLN';

/** The sale has to be of a towar SUBIEKT knows, or no ZK is created at all. */
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

/**
 * The destination row for a connection once it has stopped moving.
 *
 * Returns the row rather than asserting, so a `failed` mirror is reported with
 * the destination's own message - a bare timeout would hide the only thing that
 * makes such a failure actionable.
 */
async function waitForDestinationRow(
  api: ApiClient,
  internalOrderId: string,
  destinationConnectionId: string,
  timeoutMs: number
): Promise<{ status: string; error: string | null; externalOrderId: string | null } | null> {
  const deadline = Date.now() + timeoutMs;
  let last: { status: string; error: string | null; externalOrderId: string | null } | null = null;
  while (Date.now() < deadline) {
    const order: OrderRecord = await api.orders.getById(internalOrderId);
    const row = order.syncStatus.find((s) => s.destinationConnectionId === destinationConnectionId);
    if (row) {
      last = {
        status: row.status,
        error: row.error,
        externalOrderId: row.externalOrderId ?? null,
      };
      if (row.status !== 'pending' && row.status !== 'syncing') return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  return last;
}

/** What one sale contributed: who OpenLinker says bought, and which card Subiekt billed. */
interface Observed {
  readonly olCustomerId: string | null;
  readonly kontrahentId: number | null;
  readonly kontrahentNazwa: string | null;
  readonly zkNumer: string;
}

test.describe('Subiekt GT: kontrahent identity (#3365)', () => {
  // Serial: the third assertion compares what the first two captured, and both
  // sell into the same shop against the same catalogue.
  test.describe.configure({ mode: 'serial' });

  let first: Observed | null = null;
  let second: Observed | null = null;

  /**
   * One sale, end to end, reported as `Observed`.
   *
   * Shared by both halves so the two differ in NOTHING except the customer the
   * synthesiser mints - which is the entire experiment. Two hand-written copies
   * would leave room for a second difference to creep in and take the credit.
   */
  async function sellOnce(
    fixtures: Parameters<typeof synthesizeOrder>[0],
    driver: NonNullable<Awaited<ReturnType<typeof resolveShopDriver>>>,
    subiektId: string
  ): Promise<Observed> {
    const sale = await synthesizeOrder(fixtures, {
      quantity: 1,
      currencyId: driver.currencyId,
      driver: { product: driver.product, variant: driver.variant },
      externalProductId: driver.shopProductId,
      ingestConnection: driver.publishConnection,
    });

    const row = await waitForDestinationRow(
      fixtures.api,
      sale.order.internalOrderId,
      subiektId,
      ZK_TIMEOUT_MS
    );
    expect(
      row,
      `order ${sale.order.internalOrderId} never produced a Subiekt destination row`
    ).not.toBeNull();
    expect(
      row!.status,
      `Subiekt mirror is ${row!.status}: ${row!.error ?? 'no message'}`
    ).toBe('synced');
    expect(row!.externalOrderId, 'the synced row names no ZK').toBeTruthy();

    const bridge = buildSubiektBridgeClient();
    // NOT annotated-and-continued, unlike the sibling specs: there, the bridge
    // read is a second opinion on something OpenLinker already asserted. Here
    // the kontrahent id is the ONLY observable that can answer the question at
    // all, so continuing without it would report a pass having verified nothing.
    expect(
      bridge,
      'E2E_SUBIEKT_BRIDGE_URL / E2E_SUBIEKT_BRIDGE_TOKEN are unset, and the kontrahent id can ' +
        'only be read from the bridge - nothing about kontrahent identity is observable without it'
    ).not.toBeNull();

    const zk = await bridge!.getOrder(row!.externalOrderId!);
    expect(zk, `OpenLinker recorded ZK ${row!.externalOrderId}, and Subiekt does not have it`).not.toBeNull();

    const order: OrderRecord = await fixtures.api.orders.getById(sale.order.internalOrderId);

    return {
      olCustomerId: order.customerId,
      kontrahentId: zk!.kontrahentId,
      kontrahentNazwa: zk!.kontrahentNazwa,
      zkNumer: zk!.numer,
    };
  }

  test('the first buyer reaches a kontrahent', async ({ api, world, jobs, poll, env }, testInfo) => {
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

    first = await sellOnce({ api, world, jobs, poll }, driver!, subiekt!.id);

    expect(first.kontrahentId, `${first.zkNumer} is billed to no kontrahent at all`).not.toBeNull();
    testInfo.annotations.push({
      type: 'subiekt',
      description: `${first.zkNumer}: OL customer ${first.olCustomerId ?? '(none)'} -> kontrahent ${first.kontrahentId} "${first.kontrahentNazwa}"`,
    });
  });

  test('a DIFFERENT buyer of the same name reaches a kontrahent too', async ({
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

    second = await sellOnce({ api, world, jobs, poll }, driver!, subiekt!.id);

    expect(second.kontrahentId, `${second.zkNumer} is billed to no kontrahent at all`).not.toBeNull();
    testInfo.annotations.push({
      type: 'subiekt',
      description: `${second.zkNumer}: OL customer ${second.olCustomerId ?? '(none)'} -> kontrahent ${second.kontrahentId} "${second.kontrahentNazwa}"`,
    });
  });

  // Not async: this test awaits nothing. It compares what the two preceding
  // sales captured, which is the whole reason they run in serial.
  test('they share a NAME and do not share a CARD', ({ env }) => {
    test.skip(!env.testSubiekt, 'opt-in — set E2E_TEST_SUBIEKT=true');
    test.skip(first === null || second === null, 'a preceding sale did not complete');

    // (1) THE PREMISE, checked rather than assumed. If OpenLinker resolved both
    //     sales onto one customer - the identity is keyed on the e-mail hash,
    //     and the synthesiser's uniqueness is what keeps them apart - then one
    //     shared kontrahent would be the CORRECT answer and the assertion below
    //     would fail for a reason that has nothing to do with this fix.
    expect(
      first!.olCustomerId,
      'OpenLinker recorded no customer for the first sale, so it sent the bridge no identity ' +
        'to match on and this test cannot distinguish the fix from its absence'
    ).toBeTruthy();
    expect(
      second!.olCustomerId,
      'OpenLinker recorded no customer for the second sale'
    ).toBeTruthy();
    expect(
      second!.olCustomerId,
      'both sales resolved to ONE OpenLinker customer, so they are not two buyers and there is ' +
        'no collision here to be fixed - check that the synthesiser still mints a unique e-mail'
    ).not.toBe(first!.olCustomerId);

    // (2) THE COLLISION IS REAL. Same derived symbol, same town, same everything
    //     Subiekt can see - which is exactly why the name could never tell them
    //     apart, and why (3) means something.
    expect(
      second!.kontrahentNazwa,
      'the two buyers do not even share a name, so this pair never collided and proves nothing'
    ).toBe(first!.kontrahentNazwa);

    // (3) THE FIX.
    expect(
      second!.kontrahentId,
      `two different OpenLinker customers (${first!.olCustomerId} and ${second!.olCustomerId}) ` +
        `were both billed to kontrahent ${first!.kontrahentId} "${first!.kontrahentNazwa}" - ` +
        `${first!.zkNumer} and ${second!.zkNumer}. One of them is looking at somebody ` +
        `else's customer card.`
    ).not.toBe(first!.kontrahentId);
  });
});
