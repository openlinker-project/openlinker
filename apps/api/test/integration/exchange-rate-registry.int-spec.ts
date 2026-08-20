/**
 * Exchange Rate Registry Integration Test (#2123)
 *
 * Exercises the get-or-create chain behind `ICurrencyRateService.getRateFor`
 * against Testcontainers Postgres: the REAL `UQ_exchange_rates_key` unique
 * index, the REAL PostgreSQL `23505`, its conversion to the domain
 * `DuplicateExchangeRateError`, and the re-select that resolves it.
 *
 * WHY THIS CANNOT BE A UNIT TEST. The unit tier reaches the duplicate branch
 * only by telling a `jest.fn()` to reject with the domain error - which proves
 * the branch runs, and proves nothing about the index that is supposed to raise
 * it, the error code the repository matches on, or what two concurrent callers
 * actually observe. All three are only real against a real database.
 *
 * NO NETWORK CALL IS MADE. The provider is the real `NbpExchangeRateAdapter`
 * resolved out of the real registry - a `FakeExchangeRateAdapter` cannot be
 * substituted, because `FxIntegrationModule.onModuleInit` has already claimed
 * both `'nbp'` and `'ecb'` at boot and `register()` refuses a second claim
 * (`DuplicateExchangeRateSourceError`). The seam that IS swappable is the
 * transport underneath it: the module's `FX_FETCH_TOKEN` factory delegates to
 * the global `fetch` at call time, so replacing that global for the duration of
 * the suite keeps the real service, the real registry, the real adapter and the
 * real repository in the path while every request is answered locally.
 *
 * @module apps/api/test/integration
 */
import {
  CURRENCY_RATE_SERVICE_TOKEN,
  DuplicateExchangeRateError,
  EXCHANGE_RATE_REPOSITORY_TOKEN,
  type ExchangeRate,
  type ExchangeRateKey,
  type ICurrencyRateService,
  type StoredExchangeRate,
} from '@openlinker/core/currency';
import type { FetchLike } from '@openlinker/shared/http';
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';

/**
 * The two repository methods this spec drives, restated locally.
 *
 * `ExchangeRateRepositoryPort` is deliberately NOT imported: a repository port
 * is an intra-context contract, and `check-cross-context-imports.mjs` denies
 * `*RepositoryPort` to every consumer outside its own context - host apps and
 * their int-specs included. Naming only what is called keeps that rule intact
 * and keeps the spec's coupling to the surface it actually exercises.
 */
interface ExchangeRateRegistryWriter {
  findByKey(key: ExchangeRateKey): Promise<StoredExchangeRate | null>;
  insertIfAbsent(rate: ExchangeRate): Promise<StoredExchangeRate>;
}

/** Wednesday - a Polish working day, so the adapter makes no walk-back step. */
const RATE_DATE = '2026-06-10';
const NBP_TABLE_NUMBER = '110/A/NBP/2026';
const NBP_MID = 4.25;

const KEY: ExchangeRateKey = {
  source: 'nbp',
  from: 'EUR',
  to: 'PLN',
  rateDate: RATE_DATE,
};

/** Every row this suite writes, so a count is scoped to its own data. */
async function countRows(harness: IntegrationTestHarness): Promise<number> {
  const rows: ReadonlyArray<{ count: number }> = await harness
    .getDataSource()
    .query(
      'SELECT COUNT(*)::int AS count FROM exchange_rates WHERE source = $1 AND "fromCurrency" = $2 AND "toCurrency" = $3',
      ['nbp', 'EUR', 'PLN']
    );
  return rows[0].count;
}

describe('Exchange rate registry get-or-create (#2123)', () => {
  let harness: IntegrationTestHarness;
  let service: ICurrencyRateService;
  let repository: ExchangeRateRegistryWriter;

  const globalRef = globalThis as unknown as { fetch: FetchLike };
  let originalFetch: FetchLike;
  let fetchCallCount = 0;

  beforeAll(async () => {
    harness = await getTestHarness();
    service = harness.getApp().get<ICurrencyRateService>(CURRENCY_RATE_SERVICE_TOKEN);
    repository = harness
      .getApp()
      .get<ExchangeRateRegistryWriter>(EXCHANGE_RATE_REPOSITORY_TOKEN);

    originalFetch = globalRef.fetch;
    // Answers every NBP table-A request with the day the URL asked for, so the
    // adapter resolves the candidate to itself and never walks back.
    const stub: FetchLike = ((input: unknown) => {
      fetchCallCount += 1;
      const url = String(input);
      const day = /\/(\d{4}-\d{2}-\d{2})\//.exec(url)?.[1] ?? RATE_DATE;
      const body = JSON.stringify({
        table: 'A',
        currency: 'euro',
        code: 'EUR',
        rates: [{ no: NBP_TABLE_NUMBER, effectiveDate: day, mid: NBP_MID }],
      });
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve(body),
      });
    }) as unknown as FetchLike;
    globalThis.fetch = stub;
  });

  beforeEach(() => {
    fetchCallCount = 0;
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await teardownTestHarness();
  });

  it('should return the SAME row byte-for-byte on a second get-or-create, without a second provider call', async () => {
    const first = await service.getRateFor(KEY);
    const second = await service.getRateFor(KEY);

    // Byte-identical, every column - not merely "a row with the same rate".
    // A stamped order points at this row as evidence, so an id, a derivation
    // or a fetchedAt that moved between reads would make the evidence a
    // moving target.
    expect(second).toEqual(first);
    expect(second.id).toBe(first.id);
    expect(second.rate).toBe('4.25000000');
    expect(second.sourceRef).toBe(NBP_TABLE_NUMBER);
    expect(second.pivotCurrency).toBeNull();
    expect(second.rateDate).toBe(RATE_DATE);
    expect(second.derivation).toEqual({
      kind: 'direct',
      legs: [{ pair: 'EUR/PLN', ref: NBP_TABLE_NUMBER, effectiveDate: RATE_DATE }],
    });
    expect(second.fetchedAt.getTime()).toBe(first.fetchedAt.getTime());

    expect(fetchCallCount).toBe(1);
    expect(await countRows(harness)).toBe(1);
  });

  it('should resolve two CONCURRENT get-or-creates for the same key to exactly one row', async () => {
    // Both calls issue their pre-fetch read before either can have inserted,
    // so both miss, both fetch and both insert - which is precisely the race
    // the unique index plus the 23505 recovery exists to absorb.
    const [a, b] = await Promise.all([service.getRateFor(KEY), service.getRateFor(KEY)]);

    expect(a.id).toBe(b.id);
    expect(a).toEqual(b);
    expect(await countRows(harness)).toBe(1);
  });

  it('should raise the DOMAIN DuplicateExchangeRateError from the real unique constraint', async () => {
    // The repository is asked to insert the same natural key twice directly,
    // so the error crossing the port boundary is the converted domain one and
    // never a raw TypeORM QueryFailedError.
    const stored = await service.getRateFor(KEY);

    const sameKey: ExchangeRate = {
      source: stored.source,
      from: stored.from,
      to: stored.to,
      rateDate: stored.rateDate,
      // A DIFFERENT rate under the same key, so the row that survives can only
      // be the first one - the constraint is keyed on the pair and the date,
      // not on the value.
      rate: '9.99000000',
      sourceRef: 'a-second-attempt',
      pivotCurrency: null,
      derivation: { kind: 'direct', legs: [] },
    };

    await expect(repository.insertIfAbsent(sameKey)).rejects.toThrow(DuplicateExchangeRateError);
    expect(await countRows(harness)).toBe(1);

    const survivor = await repository.findByKey(KEY);
    expect(survivor?.rate).toBe('4.25000000');
    expect(survivor?.id).toBe(stored.id);
  });

  it('should register a row per distinct rate date rather than overwriting', async () => {
    // The key includes the date, so a second day is a second row - which is
    // what makes the registry a published-rate archive rather than a cache.
    const earlier = await service.getRateFor({ ...KEY, rateDate: '2026-06-09' });
    const later = await service.getRateFor(KEY);

    expect(earlier.id).not.toBe(later.id);
    expect(await countRows(harness)).toBe(2);
  });
});
