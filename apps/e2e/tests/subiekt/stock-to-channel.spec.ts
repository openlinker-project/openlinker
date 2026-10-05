/**
 * Subiekt GT: stock reaches the sales channel (#3365)
 *
 * The MVP promise is "synchronizacja stanow magazynowych pomiedzy Subiektem a
 * kanalami sprzedazy". Before this file nothing in the repository asserted it.
 * Three specs touch offer-quantity propagation - `lifecycle/inventory-
 * propagation.spec.ts`, `lifecycle/stale-variant-pruning.spec.ts` and the
 * golden path's `11-s9-reconciliation.spec.ts` - and none of them mentions
 * Subiekt; the first says in its own docblock that it drives the chain with
 * PrestaShop as the master. The nearest Subiekt test, `published-product-
 * order.spec.ts`, runs the OPPOSITE direction: a shop sale reduces Subiekt's
 * stock and OpenLinker's own mirror observes the drop. Nothing joined
 * "Subiekt's number" to "the number the channel is selling at".
 *
 * WHAT IT PROVES, in order:
 *   1. Subiekt's own figure moves when OpenLinker asks the bridge to move it;
 *   2. OpenLinker's available-to-promise follows by the same delta;
 *   3. the CHANNEL's own reported quantity follows too.
 *
 * Step 3 is the one that had no coverage, and it is read from the channel
 * (`GET /listings` carries the commercial snapshot the channel reported, #2024)
 * rather than from OpenLinker's mirror. Reading the mirror at the end would
 * have compared OpenLinker against itself.
 *
 * WHAT IT DOES NOT PROVE:
 *   - that every channel kind follows. It asserts the marketplace OFFER branch
 *     of the fan-out. The shop-product branch reaches only connections that
 *     carry a stock write-back capability, and the publish-only PrestaShop
 *     connection on the reference stand carries none, so there is nothing to
 *     assert there rather than something asserted weakly.
 *   - that a quantity is published for a variant in SHORTFALL. Available-to-
 *     promise is clamped at zero when outstanding holds exceed stock, so such a
 *     variant correctly publishes 0 whatever Subiekt says. The target is chosen
 *     with a positive available-to-promise precisely so the comparison is not
 *     made against a clamp.
 *
 * Opt-in like every spec in this folder: `E2E_TEST_SUBIEKT=true`, a live
 * Subiekt GT connection, and the bridge env vars. It moves real stock in a real
 * Subiekt (Subiekt records it as a PW document) and moves it back afterwards,
 * so it never runs by accident.
 *
 * @module apps/e2e/tests/subiekt
 */
import { expect, test } from '../../src/fixtures/test';
import type { OfferMapping } from '../../src/api/api.types';
import { PlatformType } from '../../src/world/world';
import { buildSubiektBridgeClient } from '../../src/api/subiekt-bridge';

/**
 * Big enough that no unrelated sale on the reference stand can coincidentally
 * produce the same figure, small enough to be a rounding error in a real
 * warehouse.
 */
const DELTA = 7;

test.describe('Subiekt GT: stock reaches the sales channel (#3365)', () => {
  test('a stock change in Subiekt reaches the channel offer quantity', async ({
    api,
    world,
    env,
  }, testInfo) => {
    test.skip(
      !env.testSubiekt,
      'opt-in — set E2E_TEST_SUBIEKT=true against a live Subiekt GT bridge'
    );
    const subiekt = world.connectionFor(PlatformType.subiektGt);
    test.skip(!subiekt, 'no Subiekt GT connection on this stack');

    // Not annotated-and-continued the way the ZK readback is: there the bridge
    // is a second opinion on a claim OpenLinker can still make on its own,
    // whereas here it is the only way to move the stock at all, so without it
    // there is no test to degrade.
    const bridge = buildSubiektBridgeClient();
    test.skip(
      bridge === null,
      'no Subiekt bridge configured — set E2E_SUBIEKT_BRIDGE_URL and E2E_SUBIEKT_BRIDGE_TOKEN'
    );

    // A marketplace connection whose offers OpenLinker may write quantities to.
    // Resolved by capability rather than by position: a stand can carry several
    // connections per platform and the positional answer is whichever sorts
    // first, which on this stand is not necessarily the one holding the offers.
    const channel = world
      .connectionsFor(PlatformType.allegro)
      .find((c) => c.status === 'active' && c.enabledCapabilities.includes('OfferManager'));
    test.skip(!channel, 'no ACTIVE marketplace connection has OfferManager enabled');

    // ── Find a target the assertion can actually be made against ───────────
    //
    // Three conditions, each of which would otherwise make the run green while
    // proving nothing: the listing must be LIVE (a quantity written to an ended
    // offer changes nothing observable), its variant must be a Subiekt towar
    // (asked of Subiekt itself rather than inferred from a mapping table), and
    // its available-to-promise must be positive (see the header - a variant in
    // shortfall publishes a clamped zero however much stock arrives).
    const page = await api.listings.list({ connectionId: channel!.id, limit: 100 });
    const live = page.items.filter(
      (r: OfferMapping) =>
        r.entityType === 'Offer' &&
        r.channelStatus?.publicationStatus === 'active' &&
        r.identity?.isStale === false &&
        typeof r.identity?.sku === 'string' &&
        r.identity.sku.length > 0
    );

    let target: { row: OfferMapping; symbol: string; magazynId: number; subiektStock: number } | null =
      null;
    for (const row of live) {
      const symbol = row.identity!.sku as string;
      const stock = await bridge!.getStock(symbol);
      if (stock === null) continue; // not a Subiekt towar
      const magazynId = stock.domyslnyMagazynId ?? stock.positions[0]?.magazynId ?? null;
      if (magazynId === null) continue;
      const position = stock.positions.find((p) => p.magazynId === magazynId);
      if (position === undefined) continue;

      const [availability] = await api.inventory.availability([row.internalId]);
      if (availability === undefined || (availability.availableToPromise ?? 0) <= 0) continue;

      target = { row, symbol, magazynId, subiektStock: position.stan };
      break;
    }

    test.skip(
      target === null,
      `no live offer on ${channel!.name} resolves to a Subiekt towar with a positive ` +
        `available-to-promise. Publish a Subiekt product to this channel, or clear the ` +
        `outstanding holds on the one that is published.`
    );

    const { row, symbol, magazynId } = target!;
    testInfo.annotations.push({
      type: 'subiekt',
      description: `towar ${symbol} -> offer ${row.externalId} on ${channel!.name}`,
    });

    // ── Before ────────────────────────────────────────────────────────────
    await api.listings.refreshOfferStatus(channel!.id, row.externalId, row.internalId);
    const beforePage = await api.listings.list({
      connectionId: channel!.id,
      search: row.externalId,
      limit: 1,
    });
    const channelBefore = beforePage.items[0]?.commercial?.availableQuantity ?? null;
    expect(
      channelBefore,
      `the channel reports no quantity for offer ${row.externalId}, so there is no ` +
        `before-value to compare against`
    ).not.toBeNull();

    const [availabilityBefore] = await api.inventory.availability([row.internalId]);
    const atpBefore = availabilityBefore.availableToPromise!;
    const subiektBefore = target!.subiektStock;

    // ── Move it in Subiekt, and put it back whatever happens ──────────────
    const stamp = `e2e-stock-to-channel-${Date.now()}`;
    const applied = await bridge!.adjustStock({
      towarSymbol: symbol,
      magazynId,
      delta: DELTA,
      uwagi: 'OpenLinker e2e stock-to-channel',
      idempotencyKey: `${stamp}-up`,
    });

    try {
      expect(
        applied.stanAfter,
        `Subiekt did not apply the adjustment to ${symbol}`
      ).toBeCloseTo(subiektBefore + DELTA, 4);

      const reread = await bridge!.getStock(symbol);
      expect(
        reread!.positions.find((p) => p.magazynId === magazynId)!.stan,
        `Subiekt re-read does not agree with what it reported at write time`
      ).toBeCloseTo(subiektBefore + DELTA, 4);

      // ── Pull it into OpenLinker ─────────────────────────────────────────
      const product = await api.products.getById(row.identity!.productId!);
      const productExternalId =
        (product.externalIds ?? []).find((e) => e.connectionId === subiekt!.id)?.externalId ?? null;
      expect(
        productExternalId,
        `no Subiekt mapping for product ${row.identity!.productId}, so the sync has nothing to ask for`
      ).not.toBeNull();

      await api.syncJobs.enqueue({
        connectionId: subiekt!.id,
        jobType: 'master.inventory.syncByExternalId',
        payload: { objectType: 'Product', externalId: productExternalId! },
        idempotencyKey: `${stamp}-sync`,
      });

      const atpAfter = await pollUntil(
        async () => {
          const [a] = await api.inventory.availability([row.internalId]);
          return a?.availableToPromise ?? null;
        },
        (value) => value === atpBefore + DELTA,
        90_000
      );
      expect(
        atpAfter,
        `OpenLinker's available-to-promise for ${symbol} did not follow Subiekt ` +
          `(was ${atpBefore}, expected ${atpBefore + DELTA})`
      ).toBe(atpBefore + DELTA);

      // ── THE NEW PART: does the CHANNEL say so ───────────────────────────
      //
      // Polled rather than read once: propagation is a job chain
      // (inventory.propagateToMarketplaces -> marketplace.offerQuantity.update)
      // and the channel is a live third party, so the write lands a beat after
      // the availability read that triggered it.
      const channelAfter = await pollUntil(
        async () => {
          await api.listings.refreshOfferStatus(channel!.id, row.externalId, row.internalId);
          const refreshed = await api.listings.list({
            connectionId: channel!.id,
            search: row.externalId,
            limit: 1,
          });
          return refreshed.items[0]?.commercial?.availableQuantity ?? null;
        },
        (value) => value === channelBefore! + DELTA,
        180_000
      );

      expect(
        channelAfter,
        `${channel!.name} still advertises ${channelAfter} for offer ${row.externalId}. ` +
          `Subiekt moved ${subiektBefore} -> ${subiektBefore + DELTA} and OpenLinker followed ` +
          `(${atpBefore} -> ${atpAfter}), so the stock change stopped between OpenLinker and ` +
          `the channel.`
      ).toBe(channelBefore! + DELTA);
    } finally {
      // The stand is somebody's real Subiekt. Reverting is best-effort: a
      // failure here must not replace the real diagnosis above with its own.
      try {
        await bridge!.adjustStock({
          towarSymbol: symbol,
          magazynId,
          delta: -DELTA,
          uwagi: 'OpenLinker e2e stock-to-channel revert',
          idempotencyKey: `${stamp}-down`,
        });
      } catch (error) {
        testInfo.annotations.push({
          type: 'subiekt',
          description:
            `could not revert ${symbol} by -${DELTA}: ${(error as Error).message}. ` +
            `Subiekt is left ${DELTA} higher than this run found it.`,
        });
      }
    }
  });
});

/** Read until the predicate holds or the deadline passes, returning the last value either way. */
async function pollUntil<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  budgetMs: number
): Promise<T> {
  const deadline = Date.now() + budgetMs;
  let last = await read();
  while (!done(last) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    last = await read();
  }
  return last;
}
