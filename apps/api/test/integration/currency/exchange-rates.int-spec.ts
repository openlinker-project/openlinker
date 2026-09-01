/**
 * Exchange Rates HTTP Surface Integration Test (#2778)
 *
 * `GET /currency/rates` against real Testcontainers Postgres. Proves the
 * property that matters most about this endpoint: it is a pure registry READ,
 * reachable by ANY authenticated user (not just admin) — never a provider
 * fetch. No network stub is installed for this suite; if the endpoint ever
 * called `ICurrencyRateService.getRateFor` instead of the lookup service, the
 * real `NbpExchangeRateAdapter` would attempt a genuine HTTP call and this
 * suite would hang or fail on an unmocked `fetch`, not silently pass.
 *
 * @module apps/api/test/integration/currency
 */
import {
  EXCHANGE_RATE_REPOSITORY_TOKEN,
  type ExchangeRate,
  type ExchangeRateKey,
  type StoredExchangeRate,
} from '@openlinker/core/currency';
import { loginAsViewer } from '../helpers/test-auth.helper';
import {
  getTestHarness,
  resetTestHarness,
  teardownTestHarness,
  type IntegrationTestHarness,
} from '../setup';

/**
 * The one repository method this spec seeds through, restated locally.
 * `ExchangeRateRepositoryPort` is deliberately NOT imported — a repository
 * port is an intra-context contract, and `check-cross-context-imports.mjs`
 * denies `*RepositoryPort` to every consumer outside its own context, host
 * apps and their int-specs included. Mirrors
 * `exchange-rate-registry.int-spec.ts`'s own `ExchangeRateRegistryWriter`.
 */
interface ExchangeRateRegistryWriter {
  findByKey(key: ExchangeRateKey): Promise<StoredExchangeRate | null>;
  insertIfAbsent(rate: ExchangeRate): Promise<StoredExchangeRate>;
}

const SEEDED_RATE: ExchangeRate = {
  source: 'nbp',
  from: 'EUR',
  to: 'PLN',
  rateDate: '2026-08-29',
  rate: '4.25000000',
  sourceRef: '167/A/NBP/2026',
  pivotCurrency: null,
  derivation: { kind: 'direct', legs: [{ pair: 'EUR/PLN', ref: '167/A/NBP/2026', effectiveDate: '2026-08-29' }] },
};

describe('GET /currency/rates (#2778)', () => {
  let harness: IntegrationTestHarness;
  let repository: ExchangeRateRegistryWriter;

  beforeAll(async () => {
    harness = await getTestHarness();
    repository = harness
      .getApp()
      .get<ExchangeRateRegistryWriter>(EXCHANGE_RATE_REPOSITORY_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('returns the stored row for a viewer — no admin role required (#2778 AC)', async () => {
    await repository.insertIfAbsent(SEEDED_RATE);
    const http = harness.getHttp();
    const token = await loginAsViewer(http, harness.getDataSource());

    const response = await http
      .get('/v1/currency/rates')
      .query({ from: 'EUR', to: 'PLN', date: '2026-08-29' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({
      from: 'EUR',
      to: 'PLN',
      rate: '4.25000000',
      rateDate: '2026-08-29',
      source: 'nbp',
      derivation: 'direct',
      sourceRef: '167/A/NBP/2026',
    });
  });

  it('404s when no rate is stored under the key', async () => {
    const http = harness.getHttp();
    const token = await loginAsViewer(http, harness.getDataSource());

    await http
      .get('/v1/currency/rates')
      .query({ from: 'EUR', to: 'PLN', date: '2099-01-01' })
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('422s when `to` names a currency no publisher serves', async () => {
    const http = harness.getHttp();
    const token = await loginAsViewer(http, harness.getDataSource());

    await http
      .get('/v1/currency/rates')
      .query({ from: 'EUR', to: 'XXX', date: '2026-08-29' })
      .set('Authorization', `Bearer ${token}`)
      .expect(422);
  });

  it('401s with no bearer token — the endpoint is not public', async () => {
    await harness
      .getHttp()
      .get('/v1/currency/rates')
      .query({ from: 'EUR', to: 'PLN', date: '2026-08-29' })
      .expect(401);
  });
});
