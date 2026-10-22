/**
 * Unit tests for the PrestaShop tax-rate resolver (#895 / ADR-014, #2052).
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { Logger } from '@openlinker/shared/logging';
import { PrestashopTaxRateResolver } from '../prestashop-tax-rate.resolver';
import type { PrestashopCountryResolver } from '../prestashop-country-resolver';
import { PrestashopApiException } from '../../../domain/exceptions/prestashop-api.exception';
import { createMockHttpClient } from '../../../__tests__/mocks/mock-http-client.factory';

describe('PrestashopTaxRateResolver', () => {
  let httpClient: ReturnType<typeof createMockHttpClient>;
  let countryResolver: jest.Mocked<PrestashopCountryResolver>;
  let resolver: PrestashopTaxRateResolver;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    httpClient = createMockHttpClient();
    countryResolver = {
      resolveCountryId: jest.fn(),
      clearCache: jest.fn(),
    } as unknown as jest.Mocked<PrestashopCountryResolver>;
    resolver = new PrestashopTaxRateResolver(countryResolver);
    // Several #2052 paths are deliberately non-blocking, so the warn is the
    // only operator-visible trace they leave — assert it, don't just silence it.
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('should resolve 0 when the product has no tax-rule group', async () => {
    // `id_tax_rules_group = 0` is PrestaShop's "No tax" dropdown entry — a
    // deliberate exemption, so it stays a RESOLVED zero and never blocks (#2052).
    httpClient.getResource.mockResolvedValueOnce({ id_tax_rules_group: '0' });

    const resolution = await resolver.resolveProductTaxRate('100', undefined, 'conn-1', httpClient);

    expect(resolution).toEqual({ kind: 'resolved', rate: 0, matchedBy: 'no-tax-group' });
    expect(httpClient.listResources).not.toHaveBeenCalled();
  });

  it('should warn on the "No tax" path so a mis-configured product is still findable in the logs', async () => {
    // The path is deliberately non-blocking, which makes the warn the ONLY
    // trace an operator who did not mean to exempt the product ever gets.
    httpClient.getResource.mockResolvedValueOnce({ id_tax_rules_group: '0' });

    await resolver.resolveProductTaxRate('100', undefined, 'conn-1', httpClient);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('PrestaShop "No tax"'));
  });

  // A MISSING field reads as the same "No tax" answer, because PrestaShop's
  // webservice omits a zero-valued `id_*` field rather than emitting `0` — a
  // real `GET /products/{id}` on an exempt product carries no
  // `id_tax_rules_group` at all. Reporting that as `unknown` blocked every
  // intentionally exempt product, which is the opposite of #2052's intent.
  it('should resolve 0 when the product read omits the tax-rule group field (PrestaShop omits zero ids)', async () => {
    httpClient.getResource.mockResolvedValueOnce({});

    const resolution = await resolver.resolveProductTaxRate('25', 'PL', 'conn-1', httpClient);

    expect(resolution).toEqual({ kind: 'resolved', rate: 0, matchedBy: 'no-tax-group' });
    expect(httpClient.listResources).not.toHaveBeenCalled();
  });

  it('should report a configuration unknown when the tax-rule group is unparseable', async () => {
    httpClient.getResource.mockResolvedValueOnce({ id_tax_rules_group: 'not-a-group' });

    const resolution = await resolver.resolveProductTaxRate('25', 'PL', 'conn-1', httpClient);

    expect(resolution).toEqual({
      kind: 'unknown',
      reason: 'configuration',
      evidence: "products/25 reports an unusable tax-rule group 'not-a-group'",
    });
  });

  it('should not cache an unusable tax-rule group, so the operator fix takes effect at once', async () => {
    countryResolver.resolveCountryId.mockResolvedValue(6);
    httpClient.listResources.mockResolvedValue([{ id_tax: '7', id_country: '6', id_state: '0' }]);
    httpClient.getResource
      .mockResolvedValueOnce({ id_tax_rules_group: 'not-a-group' }) // products/25 — unpriceable
      .mockResolvedValueOnce({ id_tax_rules_group: '2' }) // operator assigned a group
      .mockResolvedValueOnce({ rate: '23.000' });

    const first = await resolver.resolveProductTaxRate('25', 'PL', 'conn-1', httpClient);
    const second = await resolver.resolveProductTaxRate('25', 'PL', 'conn-1', httpClient);

    expect(first.kind).toBe('unknown');
    expect(second.kind === 'resolved' && second.rate).toBeCloseTo(0.23, 5);
  });

  it('should resolve the delivery-country rule and return its rate as a fraction', async () => {
    httpClient.getResource
      .mockResolvedValueOnce({ id_tax_rules_group: '2' }) // products/100
      .mockResolvedValueOnce({ rate: '23.000' }); // taxes/7
    countryResolver.resolveCountryId.mockResolvedValueOnce(6); // PL → id 6
    httpClient.listResources.mockResolvedValueOnce([
      { id_tax: '9', id_country: '0', id_state: '0' }, // catch-all
      { id_tax: '7', id_country: '6', id_state: '0' }, // PL
    ]);

    const resolution = await resolver.resolveProductTaxRate('100', 'PL', 'conn-1', httpClient);

    expect(resolution.kind).toBe('resolved');
    expect(resolution.kind === 'resolved' && resolution.rate).toBeCloseTo(0.23, 5);
    expect(resolution.kind === 'resolved' && resolution.matchedBy).toBe('country');
    expect(httpClient.getResource).toHaveBeenCalledWith('taxes', '7');
  });

  it('should fall back to the catch-all rule when the delivery country does not resolve', async () => {
    httpClient.getResource
      .mockResolvedValueOnce({ id_tax_rules_group: '2' })
      .mockResolvedValueOnce({ rate: '5.000' });
    countryResolver.resolveCountryId.mockRejectedValueOnce(new Error('country not found'));
    httpClient.listResources.mockResolvedValueOnce([
      { id_tax: '9', id_country: '0', id_state: '0' },
      { id_tax: '7', id_country: '6', id_state: '0' },
    ]);

    const resolution = await resolver.resolveProductTaxRate('100', 'ZZ', 'conn-1', httpClient);

    expect(resolution.kind === 'resolved' && resolution.rate).toBeCloseTo(0.05, 5);
    expect(resolution.kind === 'resolved' && resolution.matchedBy).toBe('catch-all');
    expect(httpClient.getResource).toHaveBeenCalledWith('taxes', '9');
  });

  it('should prefer the country-level (id_state=0) rule over a state-specific row', async () => {
    httpClient.getResource
      .mockResolvedValueOnce({ id_tax_rules_group: '2' })
      .mockResolvedValueOnce({ rate: '23.000' }); // taxes/7 (the id_state=0 row)
    countryResolver.resolveCountryId.mockResolvedValueOnce(6);
    httpClient.listResources.mockResolvedValueOnce([
      { id_tax: '8', id_country: '6', id_state: '12' }, // state-specific row first
      { id_tax: '7', id_country: '6', id_state: '0' }, // country-level row
    ]);

    const resolution = await resolver.resolveProductTaxRate('100', 'PL', 'conn-1', httpClient);

    expect(resolution.kind === 'resolved' && resolution.rate).toBeCloseTo(0.23, 5);
    expect(resolution.kind === 'resolved' && resolution.matchedBy).toBe('country');
    expect(httpClient.getResource).toHaveBeenCalledWith('taxes', '7');
  });

  it('should report a transport unknown (not 0) when the product read fails', async () => {
    httpClient.getResource.mockRejectedValueOnce(new PrestashopApiException('boom', 503));

    const resolution = await resolver.resolveProductTaxRate('25', 'PL', 'conn-1', httpClient);

    expect(resolution).toEqual({
      kind: 'unknown',
      reason: 'transport',
      evidence: 'GET products/25 returned 503',
      statusCode: 503,
    });
  });

  it('should report a transport unknown carrying the error text when the failure has no status code', async () => {
    httpClient.getResource.mockRejectedValueOnce(new Error('socket hang up'));

    const resolution = await resolver.resolveProductTaxRate('25', 'PL', 'conn-1', httpClient);

    expect(resolution.kind).toBe('unknown');
    expect(resolution.kind === 'unknown' && resolution.reason).toBe('transport');
    expect(resolution.kind === 'unknown' && resolution.evidence).toContain('socket hang up');
  });

  // #2245 review — this used to resolve a CONFIRMED 0. Since the same resolver
  // now also states the rate a fiscal document carries, an inferred zero is a
  // zero-VAT invoice the shop never claimed.
  it('should report a configuration unknown (not 0) when the tax-rule group has no rules', async () => {
    httpClient.getResource.mockResolvedValueOnce({ id_tax_rules_group: '2' });
    countryResolver.resolveCountryId.mockResolvedValueOnce(6);
    httpClient.listResources.mockResolvedValueOnce([]);

    const resolution = await resolver.resolveProductTaxRate('100', 'PL', 'conn-1', httpClient);

    expect(resolution).toEqual({
      kind: 'unknown',
      reason: 'configuration',
      evidence: 'tax-rule group 2 has no usable rule',
    });
  });

  it('should report a configuration unknown when every rule in the group names no tax', async () => {
    httpClient.getResource.mockResolvedValueOnce({ id_tax_rules_group: '2' });
    countryResolver.resolveCountryId.mockResolvedValueOnce(6);
    httpClient.listResources.mockResolvedValueOnce([
      { id_country: '6', id_state: '0' },
      { id_tax: '0', id_country: '0', id_state: '0' },
    ]);

    const resolution = await resolver.resolveProductTaxRate('100', 'PL', 'conn-1', httpClient);

    expect(resolution.kind === 'unknown' && resolution.reason).toBe('configuration');
    expect(httpClient.getResource).toHaveBeenCalledTimes(1);
  });

  // The shape the master read always hits: no delivery country is passed
  // (ADR-063 § 7), so a group of per-country rules with no catch-all has nothing
  // to single a rule out. `rules[0]` used to win, so a PL shop could project
  // DE 19% onto every line.
  it('should report an ambiguous unknown when several candidate rules and no catch-all exist', async () => {
    httpClient.getResource.mockResolvedValueOnce({ id_tax_rules_group: '2' });
    httpClient.listResources.mockResolvedValueOnce([
      { id_tax: '8', id_country: '1', id_state: '0' }, // DE 19
      { id_tax: '7', id_country: '6', id_state: '0' }, // PL 23
    ]);

    const resolution = await resolver.resolveProductTaxRate('100', undefined, 'conn-1', httpClient);

    expect(resolution.kind === 'unknown' && resolution.reason).toBe('ambiguous');
    expect(resolution.kind === 'unknown' && resolution.evidence).toContain('candidate rates');
    // Nothing was read from `taxes` - no rate was invented.
    expect(httpClient.getResource).toHaveBeenCalledTimes(1);
  });

  it('should resolve the catch-all rule rather than reporting ambiguous when one exists', async () => {
    httpClient.getResource
      .mockResolvedValueOnce({ id_tax_rules_group: '2' })
      .mockResolvedValueOnce({ rate: '23.000' }); // taxes/9 — the catch-all
    httpClient.listResources.mockResolvedValueOnce([
      { id_tax: '8', id_country: '1', id_state: '0' },
      { id_tax: '9', id_country: '0', id_state: '0' },
    ]);

    const resolution = await resolver.resolveProductTaxRate('100', undefined, 'conn-1', httpClient);

    expect(resolution.kind === 'resolved' && resolution.rate).toBeCloseTo(0.23, 5);
    expect(resolution.kind === 'resolved' && resolution.matchedBy).toBe('catch-all');
    expect(httpClient.getResource).toHaveBeenCalledWith('taxes', '9');
  });

  it('should resolve when several candidate rules all name the SAME tax', async () => {
    // Rows agreeing is not ambiguous - the answer is the same whichever the shop
    // picks, which is the rule the WooCommerce sibling already follows.
    httpClient.getResource
      .mockResolvedValueOnce({ id_tax_rules_group: '2' })
      .mockResolvedValueOnce({ rate: '23.000' });
    httpClient.listResources.mockResolvedValueOnce([
      { id_tax: '7', id_country: '1', id_state: '0' },
      { id_tax: '7', id_country: '6', id_state: '0' },
    ]);

    const resolution = await resolver.resolveProductTaxRate('100', undefined, 'conn-1', httpClient);

    expect(resolution.kind === 'resolved' && resolution.rate).toBeCloseTo(0.23, 5);
    // No country was asked and no catch-all row exists, so the group's single
    // remaining tax was taken - it is not a rate stated for any one country.
    expect(resolution.kind === 'resolved' && resolution.matchedBy).toBe('only-rule');
    expect(httpClient.getResource).toHaveBeenCalledWith('taxes', '7');
  });

  it('should report an ambiguous unknown for a multi-state country group with no country-level row', async () => {
    // The US shape. Picking the first state's rate was an arbitrary answer.
    httpClient.getResource.mockResolvedValueOnce({ id_tax_rules_group: '2' });
    countryResolver.resolveCountryId.mockResolvedValueOnce(21);
    httpClient.listResources.mockResolvedValueOnce([
      { id_tax: '11', id_country: '21', id_state: '12' },
      { id_tax: '12', id_country: '21', id_state: '13' },
    ]);

    const resolution = await resolver.resolveProductTaxRate('100', 'US', 'conn-1', httpClient);

    expect(resolution.kind === 'unknown' && resolution.reason).toBe('ambiguous');
  });

  it('should still resolve an explicit zero-rate tax group', async () => {
    // ADR-063: `0` is an answer, not a gap. A group whose tax record really says
    // 0% must keep resolving, or every legitimately zero-rated product blocks.
    httpClient.getResource
      .mockResolvedValueOnce({ id_tax_rules_group: '4' })
      .mockResolvedValueOnce({ rate: '0.000' });
    countryResolver.resolveCountryId.mockResolvedValueOnce(6);
    httpClient.listResources.mockResolvedValueOnce([{ id_tax: '3', id_country: '6', id_state: '0' }]);

    const resolution = await resolver.resolveProductTaxRate('100', 'PL', 'conn-1', httpClient);

    expect(resolution).toEqual({ kind: 'resolved', rate: 0, matchedBy: 'country' });
  });

  // Previously untested: line 120 — `taxes/<id>` answers WITHOUT a `rate` field.
  // Pre-#2052 `String(undefined ?? '0')` parsed to a finite, non-negative 0 and
  // left the resolver as a success, which is why this was the worst of the five
  // zero paths.
  it('should report a configuration unknown when the tax record carries no rate field', async () => {
    httpClient.getResource
      .mockResolvedValueOnce({ id_tax_rules_group: '2' })
      .mockResolvedValueOnce({}); // taxes/7 — no `rate` at all
    countryResolver.resolveCountryId.mockResolvedValueOnce(6);
    httpClient.listResources.mockResolvedValueOnce([{ id_tax: '7', id_country: '6', id_state: '0' }]);

    const resolution = await resolver.resolveProductTaxRate('25', 'PL', 'conn-1', httpClient);

    expect(resolution).toEqual({
      kind: 'unknown',
      reason: 'configuration',
      evidence: 'tax rule 7 in group 2 carries no rate',
    });
  });

  it('should report a configuration unknown when the tax rate is an empty string', async () => {
    httpClient.getResource
      .mockResolvedValueOnce({ id_tax_rules_group: '2' })
      .mockResolvedValueOnce({ rate: '  ' });
    countryResolver.resolveCountryId.mockResolvedValueOnce(6);
    httpClient.listResources.mockResolvedValueOnce([{ id_tax: '7', id_country: '6', id_state: '0' }]);

    const resolution = await resolver.resolveProductTaxRate('25', 'PL', 'conn-1', httpClient);

    expect(resolution.kind === 'unknown' && resolution.reason).toBe('configuration');
  });

  // Previously untested: line 118 — the rate is present but unparseable.
  it('should report a configuration unknown when the tax rate is not a finite number', async () => {
    httpClient.getResource
      .mockResolvedValueOnce({ id_tax_rules_group: '2' })
      .mockResolvedValueOnce({ rate: 'not-a-number' });
    countryResolver.resolveCountryId.mockResolvedValueOnce(6);
    httpClient.listResources.mockResolvedValueOnce([{ id_tax: '7', id_country: '6', id_state: '0' }]);

    const resolution = await resolver.resolveProductTaxRate('25', 'PL', 'conn-1', httpClient);

    expect(resolution).toEqual({
      kind: 'unknown',
      reason: 'configuration',
      evidence: "tax rule 7 in group 2 reports an unusable rate 'not-a-number'",
    });
  });

  it('should report a configuration unknown when the tax rate is negative', async () => {
    httpClient.getResource
      .mockResolvedValueOnce({ id_tax_rules_group: '2' })
      .mockResolvedValueOnce({ rate: '-5.000' });
    countryResolver.resolveCountryId.mockResolvedValueOnce(6);
    httpClient.listResources.mockResolvedValueOnce([{ id_tax: '7', id_country: '6', id_state: '0' }]);

    const resolution = await resolver.resolveProductTaxRate('25', 'PL', 'conn-1', httpClient);

    expect(resolution.kind === 'unknown' && resolution.reason).toBe('configuration');
  });

  it('should cache the resolved rate per product/country', async () => {
    httpClient.getResource
      .mockResolvedValueOnce({ id_tax_rules_group: '2' })
      .mockResolvedValueOnce({ rate: '23.000' });
    countryResolver.resolveCountryId.mockResolvedValue(6);
    httpClient.listResources.mockResolvedValueOnce([{ id_tax: '7', id_country: '6', id_state: '0' }]);

    const first = await resolver.resolveProductTaxRate('100', 'PL', 'conn-1', httpClient);
    const second = await resolver.resolveProductTaxRate('100', 'PL', 'conn-1', httpClient);

    // products + taxes read once each (second call served from cache).
    expect(httpClient.getResource).toHaveBeenCalledTimes(2);
    // The cached answer keeps how the rate was matched, not only the rate.
    expect(first).toEqual({ kind: 'resolved', rate: 0.23, matchedBy: 'country' });
    expect(second).toEqual(first);
  });

  // The operator fixes the tax record and presses Retry. If the unknown had
  // been cached, the retry would answer from memory for up to 5 minutes and
  // read as "the fix did not work".
  it('should not cache an unknown, so a retry re-reads the shop', async () => {
    countryResolver.resolveCountryId.mockResolvedValue(6);
    httpClient.listResources.mockResolvedValue([{ id_tax: '7', id_country: '6', id_state: '0' }]);
    httpClient.getResource
      .mockResolvedValueOnce({ id_tax_rules_group: '2' }) // products/25 (1st call)
      .mockResolvedValueOnce({}) // taxes/7 — no rate → unknown
      .mockResolvedValueOnce({ id_tax_rules_group: '2' }) // products/25 (2nd call)
      .mockResolvedValueOnce({ rate: '23.000' }); // taxes/7 — operator fixed it

    const first = await resolver.resolveProductTaxRate('25', 'PL', 'conn-1', httpClient);
    const second = await resolver.resolveProductTaxRate('25', 'PL', 'conn-1', httpClient);

    expect(first.kind).toBe('unknown');
    expect(second.kind === 'resolved' && second.rate).toBeCloseTo(0.23, 5);
    expect(httpClient.getResource).toHaveBeenCalledTimes(4);
  });

  it('should not cache a transport unknown either', async () => {
    countryResolver.resolveCountryId.mockResolvedValue(6);
    httpClient.listResources.mockResolvedValue([{ id_tax: '7', id_country: '6', id_state: '0' }]);
    httpClient.getResource
      .mockRejectedValueOnce(new PrestashopApiException('gateway', 503))
      .mockResolvedValueOnce({ id_tax_rules_group: '2' })
      .mockResolvedValueOnce({ rate: '23.000' });

    const first = await resolver.resolveProductTaxRate('25', 'PL', 'conn-1', httpClient);
    const second = await resolver.resolveProductTaxRate('25', 'PL', 'conn-1', httpClient);

    expect(first.kind === 'unknown' && first.reason).toBe('transport');
    expect(second.kind === 'resolved' && second.rate).toBeCloseTo(0.23, 5);
  });

  // The other two reads on the chain used to throw raw, so a 503 there produced
  // a generic PrestaShop error instead of the operator copy this resolver owns.
  it('should report a transport unknown when the tax-rule listing fails', async () => {
    httpClient.getResource.mockResolvedValueOnce({ id_tax_rules_group: '2' });
    countryResolver.resolveCountryId.mockResolvedValueOnce(6);
    httpClient.listResources.mockRejectedValueOnce(new PrestashopApiException('boom', 502));

    const resolution = await resolver.resolveProductTaxRate('25', 'PL', 'conn-1', httpClient);

    expect(resolution).toEqual({
      kind: 'unknown',
      reason: 'transport',
      evidence: 'GET tax_rules?id_tax_rules_group=2 returned 502',
      statusCode: 502,
    });
  });

  it('should report a transport unknown when the tax record read fails', async () => {
    httpClient.getResource
      .mockResolvedValueOnce({ id_tax_rules_group: '2' })
      .mockRejectedValueOnce(new PrestashopApiException('boom', 503));
    countryResolver.resolveCountryId.mockResolvedValueOnce(6);
    httpClient.listResources.mockResolvedValueOnce([{ id_tax: '7', id_country: '6', id_state: '0' }]);

    const resolution = await resolver.resolveProductTaxRate('25', 'PL', 'conn-1', httpClient);

    expect(resolution).toEqual({
      kind: 'unknown',
      reason: 'transport',
      evidence: 'GET taxes/7 returned 503',
      statusCode: 503,
    });
  });

  // `evidence` is rendered to the operator, not logged, so an unbounded upstream
  // error message must not flow into it verbatim.
  it('should cap the error detail carried into the evidence clause', async () => {
    httpClient.getResource.mockRejectedValueOnce(new Error('x'.repeat(500)));

    const resolution = await resolver.resolveProductTaxRate('25', 'PL', 'conn-1', httpClient);

    expect(resolution.kind === 'unknown' && resolution.evidence.length).toBeLessThan(140);
    expect(resolution.kind === 'unknown' && resolution.evidence).toContain('…');
  });

  it('should warn when the delivery country cannot be resolved and the catch-all rule is used', async () => {
    // Falling through to the catch-all silently picks a possibly different rate
    // than the delivery country's — a pricing decision, so it warns (#2052).
    countryResolver.resolveCountryId.mockRejectedValueOnce(new Error('country lookup failed'));
    httpClient.getResource
      .mockResolvedValueOnce({ id_tax_rules_group: '2' })
      .mockResolvedValueOnce({ rate: '23.000' });
    httpClient.listResources.mockResolvedValueOnce([{ id_tax: '7', id_country: '0', id_state: '0' }]);

    await resolver.resolveProductTaxRate('25', 'PL', 'conn-1', httpClient);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('using catch-all tax rule'));
  });
  describe('preloaded product (#2592)', () => {
    it('should skip the products read when the caller hands over the product it already fetched', async () => {
      httpClient.getResource.mockResolvedValueOnce({ rate: '23.000' });
      httpClient.listResources.mockResolvedValueOnce([
        { id_tax: '7', id_country: '0', id_state: '0' },
      ]);

      const resolution = await resolver.resolveProductTaxRate(
        '25',
        undefined,
        'conn-1',
        httpClient,
        { id_tax_rules_group: '2' }
      );

      expect(resolution).toEqual({ kind: 'resolved', rate: 0.23, matchedBy: 'catch-all' });
      expect(
        httpClient.getResource.mock.calls.filter((call) => call[0] === 'products')
      ).toHaveLength(0);
    });

    it('should fetch the product itself when the caller hands over nothing (unchanged path)', async () => {
      httpClient.getResource
        .mockResolvedValueOnce({ id_tax_rules_group: '2' })
        .mockResolvedValueOnce({ rate: '23.000' });
      httpClient.listResources.mockResolvedValueOnce([
        { id_tax: '7', id_country: '0', id_state: '0' },
      ]);

      const resolution = await resolver.resolveProductTaxRate('25', undefined, 'conn-1', httpClient);

      expect(resolution).toEqual({ kind: 'resolved', rate: 0.23, matchedBy: 'catch-all' });
      expect(httpClient.getResource).toHaveBeenCalledWith('products', '25');
    });
  });
  // The resolver is a process-singleton since #2592, so two connections share
  // one instance. Its cache key leads with the connection id; these tests are
  // what make that auditable rather than argued, matching the sibling
  // resolvers' own cross-connection specs.
  describe('cross-connection isolation (#2592)', () => {
    const taxedProduct = { id_tax_rules_group: '2' };
    const catchAllRule = [{ id_tax: '7', id_country: '0', id_state: '0' }];

    it('should resolve independently for two connections asking about the same product id', async () => {
      httpClient.getResource
        .mockResolvedValueOnce(taxedProduct)
        .mockResolvedValueOnce({ rate: '23.000' })
        .mockResolvedValueOnce(taxedProduct)
        .mockResolvedValueOnce({ rate: '8.000' });
      httpClient.listResources
        .mockResolvedValueOnce(catchAllRule)
        .mockResolvedValueOnce(catchAllRule);

      const first = await resolver.resolveProductTaxRate('25', undefined, 'conn-1', httpClient);
      const second = await resolver.resolveProductTaxRate('25', undefined, 'conn-2', httpClient);

      expect(first).toEqual({ kind: 'resolved', rate: 0.23, matchedBy: 'catch-all' });
      expect(second).toEqual({ kind: 'resolved', rate: 0.08, matchedBy: 'catch-all' });
    });

    it('should clear one connection and leave the other cached', async () => {
      httpClient.getResource
        .mockResolvedValueOnce(taxedProduct)
        .mockResolvedValueOnce({ rate: '23.000' })
        .mockResolvedValueOnce(taxedProduct)
        .mockResolvedValueOnce({ rate: '23.000' })
        .mockResolvedValueOnce(taxedProduct)
        .mockResolvedValueOnce({ rate: '8.000' });
      httpClient.listResources.mockResolvedValue(catchAllRule);

      await resolver.resolveProductTaxRate('25', undefined, 'conn-1', httpClient);
      await resolver.resolveProductTaxRate('25', undefined, 'conn-2', httpClient);

      resolver.clearCache('conn-1');

      // conn-1 misses and re-reads; conn-2 still answers from its own entry.
      const reread = await resolver.resolveProductTaxRate('25', undefined, 'conn-1', httpClient);
      const cached = await resolver.resolveProductTaxRate('25', undefined, 'conn-2', httpClient);

      expect(reread).toEqual({ kind: 'resolved', rate: 0.08, matchedBy: 'catch-all' });
      expect(cached).toEqual({ kind: 'resolved', rate: 0.23, matchedBy: 'catch-all' });
      expect(countryResolver.clearCache).toHaveBeenCalledWith('conn-1');
    });
  });

  // ADR-077: the product master resolves the sales country itself and turns
  // "no such country" into its own answer, so the resolver must not take the
  // ISO route (and its silent catch-all fallback) when it is handed an id.
  describe('an already-resolved country id (ADR-077)', () => {
    it('should use the given country id and not resolve an ISO when options.countryId is set', async () => {
      httpClient.getResource.mockResolvedValueOnce({ rate: '23.000' }); // taxes/7
      httpClient.listResources.mockResolvedValueOnce([
        { id_tax: '9', id_country: '0', id_state: '0' }, // catch-all
        { id_tax: '7', id_country: '14', id_state: '0' }, // PL
      ]);

      const resolution = await resolver.resolveProductTaxRate(
        '25',
        'DE',
        'conn-1',
        httpClient,
        { id_tax_rules_group: '2' },
        { countryId: 14 }
      );

      expect(resolution).toEqual({ kind: 'resolved', rate: 0.23, matchedBy: 'country' });
      expect(countryResolver.resolveCountryId).not.toHaveBeenCalled();
      expect(httpClient.getResource).toHaveBeenCalledWith('taxes', '7');
    });

    it('should report only-rule when the given country has no rule and the group names one other country', async () => {
      // The US-default-shop shape: the group only names PL, so the 23% it
      // reports is a rate from ANOTHER country, and matchedBy says so.
      httpClient.getResource.mockResolvedValueOnce({ rate: '23.000' });
      httpClient.listResources.mockResolvedValueOnce([
        { id_tax: '7', id_country: '14', id_state: '0' },
      ]);

      const resolution = await resolver.resolveProductTaxRate(
        '25',
        undefined,
        'conn-1',
        httpClient,
        { id_tax_rules_group: '2' },
        { countryId: 21 }
      );

      expect(resolution).toEqual({ kind: 'resolved', rate: 0.23, matchedBy: 'only-rule' });
    });

    it('should resolve the delivery ISO as before when options carry no country id', async () => {
      countryResolver.resolveCountryId.mockResolvedValueOnce(14);
      httpClient.getResource.mockResolvedValueOnce({ rate: '23.000' });
      httpClient.listResources.mockResolvedValueOnce([
        { id_tax: '7', id_country: '14', id_state: '0' },
      ]);

      const resolution = await resolver.resolveProductTaxRate(
        '25',
        'PL',
        'conn-1',
        httpClient,
        { id_tax_rules_group: '2' },
        {}
      );

      expect(resolution).toEqual({ kind: 'resolved', rate: 0.23, matchedBy: 'country' });
      expect(countryResolver.resolveCountryId).toHaveBeenCalledWith('PL', 'conn-1', httpClient);
    });
  });

  // ADR-077: products share a handful of tax-rule groups, so the rule and tax
  // reads are cached per (connection, group, country) and shared between the
  // product path and the publisher's group path.
  describe('per-group cache (ADR-077)', () => {
    const plRule = [{ id_tax: '7', id_country: '14', id_state: '0' }];

    it('should read the rules and the tax once when two products share a group and country', async () => {
      httpClient.getResource.mockResolvedValueOnce({ rate: '23.000' });
      httpClient.listResources.mockResolvedValueOnce(plRule);

      const first = await resolver.resolveProductTaxRate(
        '25',
        undefined,
        'conn-1',
        httpClient,
        { id_tax_rules_group: '2' },
        { countryId: 14 }
      );
      const second = await resolver.resolveProductTaxRate(
        '26',
        undefined,
        'conn-1',
        httpClient,
        { id_tax_rules_group: '2' },
        { countryId: 14 }
      );

      expect(first).toEqual({ kind: 'resolved', rate: 0.23, matchedBy: 'country' });
      expect(second).toEqual(first);
      expect(httpClient.listResources).toHaveBeenCalledTimes(1);
      expect(httpClient.getResource).toHaveBeenCalledTimes(1);
    });

    it('should answer the group lookup from a rate the product path already resolved', async () => {
      httpClient.getResource.mockResolvedValueOnce({ rate: '23.000' });
      httpClient.listResources.mockResolvedValueOnce(plRule);

      await resolver.resolveProductTaxRate(
        '25',
        undefined,
        'conn-1',
        httpClient,
        { id_tax_rules_group: '2' },
        { countryId: 14 }
      );
      const group = await resolver.resolveTaxRulesGroupRate(2, 14, 'conn-1', httpClient);

      expect(group).toEqual({ kind: 'resolved', rate: 0.23, matchedBy: 'country' });
      expect(httpClient.listResources).toHaveBeenCalledTimes(1);
      expect(httpClient.getResource).toHaveBeenCalledTimes(1);
    });

    it('should re-read the group for a different country', async () => {
      httpClient.listResources.mockResolvedValue([
        { id_tax: '7', id_country: '14', id_state: '0' }, // PL 23
        { id_tax: '8', id_country: '1', id_state: '0' }, // DE 19
      ]);
      httpClient.getResource
        .mockResolvedValueOnce({ rate: '23.000' })
        .mockResolvedValueOnce({ rate: '19.000' });

      const pl = await resolver.resolveTaxRulesGroupRate(2, 14, 'conn-1', httpClient);
      const de = await resolver.resolveTaxRulesGroupRate(2, 1, 'conn-1', httpClient);

      expect(pl).toEqual({ kind: 'resolved', rate: 0.23, matchedBy: 'country' });
      expect(de).toEqual({ kind: 'resolved', rate: 0.19, matchedBy: 'country' });
      expect(httpClient.listResources).toHaveBeenCalledTimes(2);
    });

    it('should re-read the group for a different connection', async () => {
      httpClient.listResources.mockResolvedValue(plRule);
      httpClient.getResource
        .mockResolvedValueOnce({ rate: '23.000' })
        .mockResolvedValueOnce({ rate: '8.000' });

      const first = await resolver.resolveTaxRulesGroupRate(2, 14, 'conn-1', httpClient);
      const second = await resolver.resolveTaxRulesGroupRate(2, 14, 'conn-2', httpClient);

      expect(first).toEqual({ kind: 'resolved', rate: 0.23, matchedBy: 'country' });
      expect(second).toEqual({ kind: 'resolved', rate: 0.08, matchedBy: 'country' });
    });
  });

  describe('resolveTaxRulesGroupRate (ADR-077)', () => {
    it('should resolve 0 without any read when the group is the "No tax" group 0', async () => {
      const resolution = await resolver.resolveTaxRulesGroupRate(0, 14, 'conn-1', httpClient);

      expect(resolution).toEqual({ kind: 'resolved', rate: 0, matchedBy: 'no-tax-group' });
      expect(httpClient.listResources).not.toHaveBeenCalled();
      expect(httpClient.getResource).not.toHaveBeenCalled();
    });

    it('should read the rules of that group and resolve the country rule', async () => {
      httpClient.listResources.mockResolvedValueOnce([
        { id_tax: '9', id_country: '0', id_state: '0' },
        { id_tax: '7', id_country: '14', id_state: '0' },
      ]);
      httpClient.getResource.mockResolvedValueOnce({ rate: '23.000' });

      const resolution = await resolver.resolveTaxRulesGroupRate(3, 14, 'conn-1', httpClient);

      expect(resolution).toEqual({ kind: 'resolved', rate: 0.23, matchedBy: 'country' });
      expect(httpClient.listResources).toHaveBeenCalledWith(
        'tax_rules',
        expect.objectContaining({ custom: { id_tax_rules_group: 3 } }),
        100,
        0
      );
      expect(httpClient.getResource).toHaveBeenCalledWith('taxes', '7');
    });

    it('should report a configuration unknown naming the group when it has no usable rule', async () => {
      httpClient.listResources.mockResolvedValueOnce([]);

      const resolution = await resolver.resolveTaxRulesGroupRate(3, 14, 'conn-1', httpClient);

      expect(resolution).toEqual({
        kind: 'unknown',
        reason: 'configuration',
        evidence: 'tax-rule group 3 has no usable rule',
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Tax rate unknown for tax-rule group 3'));
    });

    it('should report a transport unknown when the rule read fails', async () => {
      httpClient.listResources.mockRejectedValueOnce(new PrestashopApiException('boom', 502));

      const resolution = await resolver.resolveTaxRulesGroupRate(3, 14, 'conn-1', httpClient);

      expect(resolution).toEqual({
        kind: 'unknown',
        reason: 'transport',
        evidence: 'GET tax_rules?id_tax_rules_group=3 returned 502',
        statusCode: 502,
      });
    });

    it('should not cache an unknown group answer, so a fixed group is read again', async () => {
      httpClient.listResources
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id_tax: '7', id_country: '14', id_state: '0' }]);
      httpClient.getResource.mockResolvedValueOnce({ rate: '23.000' });

      const first = await resolver.resolveTaxRulesGroupRate(3, 14, 'conn-1', httpClient);
      const second = await resolver.resolveTaxRulesGroupRate(3, 14, 'conn-1', httpClient);

      expect(first.kind).toBe('unknown');
      expect(second).toEqual({ kind: 'resolved', rate: 0.23, matchedBy: 'country' });
      expect(httpClient.listResources).toHaveBeenCalledTimes(2);
    });
  });

  // ADR-077: the publisher writes a tax-rule group onto a product so that
  // PrestaShop re-grosses its net price to the gross OpenLinker holds.
  describe('findTaxRulesGroupForRate (ADR-077)', () => {
    interface GroupRow {
      id: string;
      active?: string;
      deleted?: string;
    }
    interface RuleRow {
      id_tax: string;
      id_country: string;
      id_state: string;
    }

    /** Serve a shop's groups, rules and taxes keyed on what is read. */
    const wireShop = (
      groups: GroupRow[],
      rulesByGroup: Record<string, RuleRow[]>,
      ratesByTax: Record<string, string>
    ): void => {
      httpClient.listResources.mockImplementation((resource, filters) => {
        if (resource === 'tax_rule_groups') {
          return Promise.resolve(groups);
        }
        if (resource === 'tax_rules') {
          const groupId = String(filters?.custom?.id_tax_rules_group);
          return Promise.resolve(rulesByGroup[groupId] ?? []);
        }
        return Promise.reject(new Error(`unexpected list ${resource}`));
      });
      httpClient.getResource.mockImplementation((resource, id) => {
        if (resource === 'taxes') {
          return Promise.resolve({ rate: ratesByTax[String(id)] });
        }
        return Promise.reject(new Error(`unexpected read ${resource}/${String(id)}`));
      });
    };

    const ruleReadGroupIds = (): string[] =>
      httpClient.listResources.mock.calls
        .filter((call) => call[0] === 'tax_rules')
        .map((call) => String(call[1]?.custom?.id_tax_rules_group));

    const plRule = (taxId: string): RuleRow[] => [
      { id_tax: taxId, id_country: '14', id_state: '0' },
    ];

    it('should return the lowest active, non-deleted group whose rule for the country charges the rate', async () => {
      wireShop(
        [
          { id: '9' },
          { id: '5', active: '1', deleted: '0' },
          { id: '1', active: '0' }, // inactive - would qualify
          { id: '2', deleted: '1' }, // deleted - would qualify
          { id: '3' },
          { id: '4' },
        ],
        {
          '1': plRule('7'),
          '2': plRule('7'),
          '3': plRule('10'), // PL, but 8%
          '4': [{ id_tax: '7', id_country: '0', id_state: '0' }], // 23%, catch-all only
          '5': plRule('7'),
          '9': plRule('7'),
        },
        { '7': '23.000', '10': '8.000' }
      );

      const groupId = await resolver.findTaxRulesGroupForRate(23, 14, 'conn-1', httpClient);

      expect(groupId).toBe(5);
      // Walked in ascending id order, stopping at the first qualifying group.
      expect(ruleReadGroupIds()).toEqual(['3', '4', '5']);
      expect(httpClient.listResources).toHaveBeenCalledWith(
        'tax_rule_groups',
        { sort: ['id_ASC'] },
        100,
        0
      );
    });

    it('should take the lowest id when several groups qualify, whatever order the shop lists them in', async () => {
      wireShop([{ id: '12' }, { id: '6' }], { '6': plRule('7'), '12': plRule('7') }, {
        '7': '23.000',
      });

      const groupId = await resolver.findTaxRulesGroupForRate(23, 14, 'conn-1', httpClient);

      expect(groupId).toBe(6);
    });

    it('should match a rate whose fraction does not round-trip exactly through percent', async () => {
      // 7 / 100 * 100 is 7.000000000000001 in floating point.
      wireShop([{ id: '3' }], { '3': plRule('11') }, { '11': '7.000' });

      const groupId = await resolver.findTaxRulesGroupForRate(7, 14, 'conn-1', httpClient);

      expect(groupId).toBe(3);
    });

    it('should return null when no group charges the rate through a rule for that country', async () => {
      wireShop(
        [{ id: '3' }, { id: '4' }],
        {
          '3': plRule('10'), // PL 8%
          '4': [{ id_tax: '7', id_country: '1', id_state: '0' }], // 23%, DE only
        },
        { '7': '23.000', '10': '8.000' }
      );

      const groupId = await resolver.findTaxRulesGroupForRate(23, 14, 'conn-1', httpClient);

      expect(groupId).toBeNull();
    });

    it('should return null when the shop has no tax-rule groups', async () => {
      wireShop([], {}, {});

      const groupId = await resolver.findTaxRulesGroupForRate(23, 14, 'conn-1', httpClient);

      expect(groupId).toBeNull();
    });

    it('should skip a group whose rate is a configuration or ambiguous unknown and keep looking', async () => {
      wireShop(
        [{ id: '3' }, { id: '4' }, { id: '5' }],
        {
          '3': [], // no usable rule
          '4': [
            { id_tax: '11', id_country: '14', id_state: '1' },
            { id_tax: '12', id_country: '14', id_state: '2' },
          ], // ambiguous: state rows only
          '5': plRule('7'),
        },
        { '7': '23.000' }
      );

      const groupId = await resolver.findTaxRulesGroupForRate(23, 14, 'conn-1', httpClient);

      expect(groupId).toBe(5);
    });

    it('should report a transport unknown when the group listing fails', async () => {
      httpClient.listResources.mockRejectedValueOnce(new PrestashopApiException('boom', 503));

      const result = await resolver.findTaxRulesGroupForRate(23, 14, 'conn-1', httpClient);

      expect(result).toEqual({
        kind: 'unknown',
        reason: 'transport',
        evidence: 'GET tax_rule_groups returned 503',
        statusCode: 503,
      });
    });

    it("should stop and report a transport unknown when one group's rules cannot be read", async () => {
      httpClient.listResources.mockImplementation((resource, filters) => {
        if (resource === 'tax_rule_groups') {
          return Promise.resolve([{ id: '3' }, { id: '5' }]);
        }
        if (String(filters?.custom?.id_tax_rules_group) === '3') {
          return Promise.reject(new PrestashopApiException('boom', 502));
        }
        return Promise.resolve(plRule('7'));
      });
      httpClient.getResource.mockResolvedValue({ rate: '23.000' });

      const result = await resolver.findTaxRulesGroupForRate(23, 14, 'conn-1', httpClient);

      expect(result).toEqual({
        kind: 'unknown',
        reason: 'transport',
        evidence: 'GET tax_rules?id_tax_rules_group=3 returned 502',
        statusCode: 502,
      });
      // Group 5 would qualify, but a transport failure is not "no match".
      expect(ruleReadGroupIds()).toEqual(['3']);
    });

    it('should cache the group list and the group rates per connection', async () => {
      wireShop([{ id: '5' }], { '5': plRule('7') }, { '7': '23.000' });

      await resolver.findTaxRulesGroupForRate(23, 14, 'conn-1', httpClient);
      const again = await resolver.findTaxRulesGroupForRate(23, 14, 'conn-1', httpClient);

      expect(again).toBe(5);
      expect(httpClient.listResources).toHaveBeenCalledTimes(2); // groups + rules, once each
      expect(httpClient.getResource).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearCache (ADR-077 group caches)', () => {
    it('should drop the group list and the group rates for one connection only', async () => {
      httpClient.listResources.mockImplementation((resource) =>
        Promise.resolve(
          resource === 'tax_rule_groups'
            ? [{ id: '5' }]
            : [{ id_tax: '7', id_country: '14', id_state: '0' }]
        )
      );
      httpClient.getResource.mockResolvedValue({ rate: '23.000' });

      await resolver.findTaxRulesGroupForRate(23, 14, 'conn-1', httpClient);
      await resolver.findTaxRulesGroupForRate(23, 14, 'conn-2', httpClient);
      expect(httpClient.listResources).toHaveBeenCalledTimes(4);

      resolver.clearCache('conn-1');
      await resolver.findTaxRulesGroupForRate(23, 14, 'conn-1', httpClient);
      await resolver.findTaxRulesGroupForRate(23, 14, 'conn-2', httpClient);

      // conn-1 re-lists its groups and re-reads the group's rules; conn-2 reads nothing.
      expect(httpClient.listResources).toHaveBeenCalledTimes(6);
      expect(countryResolver.clearCache).toHaveBeenCalledWith('conn-1');
    });

    it('should drop every cache, including the group list, when called without a connection', async () => {
      httpClient.listResources.mockImplementation((resource) =>
        Promise.resolve(
          resource === 'tax_rule_groups'
            ? [{ id: '5' }]
            : [{ id_tax: '7', id_country: '14', id_state: '0' }]
        )
      );
      httpClient.getResource.mockResolvedValue({ rate: '23.000' });

      await resolver.findTaxRulesGroupForRate(23, 14, 'conn-1', httpClient);
      resolver.clearCache();
      await resolver.findTaxRulesGroupForRate(23, 14, 'conn-1', httpClient);

      expect(
        httpClient.listResources.mock.calls.filter((call) => call[0] === 'tax_rule_groups')
      ).toHaveLength(2);
      expect(httpClient.getResource).toHaveBeenCalledTimes(2);
      expect(countryResolver.clearCache).toHaveBeenCalledWith();
    });

    it('should drop a cached group rate for that connection', async () => {
      httpClient.listResources.mockResolvedValue([
        { id_tax: '7', id_country: '14', id_state: '0' },
      ]);
      httpClient.getResource.mockResolvedValue({ rate: '23.000' });

      await resolver.resolveTaxRulesGroupRate(2, 14, 'conn-1', httpClient);
      await resolver.resolveTaxRulesGroupRate(2, 14, 'conn-1', httpClient);
      expect(httpClient.listResources).toHaveBeenCalledTimes(1);

      resolver.clearCache('conn-1');
      await resolver.resolveTaxRulesGroupRate(2, 14, 'conn-1', httpClient);

      expect(httpClient.listResources).toHaveBeenCalledTimes(2);
    });
  });
});
