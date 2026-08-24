/**
 * Order ingestion: a PrestaShop order keeps the currency the buyer paid in (#2277)
 *
 * Until #2277 the PrestaShop order mapper emitted a literal `currency: 'EUR'`
 * on every ingested order, so a PLN shop recorded PLN amounts under a EUR
 * denomination. The amounts were right and only the label lied, which is why it
 * survived so long - and why it mattered anyway: the ADR-040 reporting stamp
 * multiplies the order total by the NATIVE currency's rate, and the invoicing
 * and fiscalization mappers hand the same value to KSeF / inFakt / Subiekt
 * verbatim.
 *
 * WHY TWO ORDERS, NOT ONE. Asserting a single PLN order would pass just as well
 * against a fix that swapped one hardcoded literal for another, or that always
 * substituted the shop's default currency. Two orders synthesized in two
 * DIFFERENT currencies, in the same run against the same shop, can only both
 * hold if the value is read per-order. That is the property the fix actually
 * claims, so it is the property this asserts.
 *
 * MUTATING: synthesizes real PrestaShop orders (customer, address, cart, order)
 * through the webservice, exactly as the invoicing suite does. It runs in its
 * own project with `retries: 0` rather than under `orders`, whose read-only
 * contract the config states explicitly.
 *
 * @module tests/order-ingestion
 */
import { test, expect } from '../../src/fixtures/test';
import { buildPrestashopWebserviceClient, synthesizeOrder } from '../../src/support/order-synthesis';
import { narrowOrderSnapshot } from '../../src/support/order-snapshot';

/** The slice of the snapshot this spec reads. */
interface CurrencySnapshot {
  totals?: { currency?: unknown };
}

/**
 * Two currencies a Polish-market install realistically carries. Both are
 * resolved by ISO at run time - PrestaShop currency ids are per-install, so a
 * hardcoded id would denominate the order in whatever that shop happens to
 * carry at that position.
 */
const CURRENCIES = ['PLN', 'EUR'] as const;

test.describe('order ingestion: per-order currency (#2277)', () => {
  test('records each PrestaShop order in its own currency', async ({ api, world, jobs, poll }) => {
    const ps = buildPrestashopWebserviceClient(world);
    test.skip(
      !ps,
      'needs OL_PS_WEBSERVICE_KEY (+ a resolvable PS base URL) to synthesize PrestaShop orders'
    );

    const currencyIds = new Map<string, string>();
    for (const iso of CURRENCIES) {
      const id = await ps!.getCurrencyIdByIso(iso);
      // A shop that does not carry both currencies cannot express the
      // per-order property at all, so skip with the reason rather than
      // asserting something weaker against one currency.
      test.skip(!id, `the shop carries no ${iso} currency, so a per-order comparison is impossible`);
      currencyIds.set(iso, id!);
    }

    const observed = new Map<string, string>();
    for (const iso of CURRENCIES) {
      const { order, externalOrderId } = await synthesizeOrder(
        { api, world, jobs, poll },
        { currencyId: currencyIds.get(iso) }
      );
      const snapshot = narrowOrderSnapshot<CurrencySnapshot>(order);
      const currency = snapshot.totals?.currency;

      expect(
        currency,
        `PrestaShop order ${externalOrderId} was created in ${iso} and must be recorded in ${iso}`
      ).toBe(iso);
      observed.set(iso, String(currency));
    }

    // The regression itself: before #2277 both orders read 'EUR', so this is
    // the assertion that fails on a reverted mapper even if the shop default
    // happens to make the single-order case look correct.
    expect(
      observed.get('PLN'),
      'a PLN order must not inherit the pre-#2277 hardcoded EUR literal'
    ).not.toBe(observed.get('EUR'));
  });
});
