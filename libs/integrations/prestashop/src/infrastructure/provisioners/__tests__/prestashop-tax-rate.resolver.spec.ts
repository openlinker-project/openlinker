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

    expect(resolution).toEqual({ kind: 'resolved', rate: 0 });
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

    expect(resolution).toEqual({ kind: 'resolved', rate: 0 });
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

    expect(resolution).toEqual({ kind: 'resolved', rate: 0 });
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

    await resolver.resolveProductTaxRate('100', 'PL', 'conn-1', httpClient);
    await resolver.resolveProductTaxRate('100', 'PL', 'conn-1', httpClient);

    // products + taxes read once each (second call served from cache).
    expect(httpClient.getResource).toHaveBeenCalledTimes(2);
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

      expect(resolution).toEqual({ kind: 'resolved', rate: 0.23 });
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

      expect(resolution).toEqual({ kind: 'resolved', rate: 0.23 });
      expect(httpClient.getResource).toHaveBeenCalledWith('products', '25');
    });
  });
});
