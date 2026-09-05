/**
 * The anti-vacuity guard for the publication-day contract suite
 * (#2800 review, finding 2)
 *
 * A contract suite is exactly the machinery that can look thorough and
 * assert nothing (#2673). This file combines what the fulfilment kit
 * (#2404) splits into two specs - coverage and vacuity - because this
 * suite has one small case table rather than several large ones; keeping
 * both concerns in one file is proportionate here (see the suite's own file
 * header, "Scaled down from that kit deliberately").
 *
 * Three things are asserted, in order of how much they would let slip past
 * unnoticed if missing.
 *
 * 1. **Declared === covered.** The `checks` counter on `ContractCaseResult`
 *    is self-reported, so it only catches a case that never RAN - not one
 *    that ran and compared nothing. What actually holds the suite honest is
 *    that every declared case has a deliberate, minimal breakage proving it
 *    can fail, and that no such fixture targets an undeclared case.
 * 2. **Absence is a recognised, not a silent, state.** A provider that omits
 *    `resolveExpectedPublicationDay` is conforming (the method is optional),
 *    and the pure checker must report zero cases without throwing - and a
 *    provider whose property exists but is not a function must be treated
 *    identically, proving the probe checks the type at runtime rather than
 *    trusting the shape.
 * 3. **The two structural faults still throw.** No subject, and a subject
 *    missing the base port's required members, must never read as "0
 *    failures" - the #2673 shape of "not covered" and "covered and passing"
 *    collapsing into one green reading.
 *
 * @module libs/core/src/currency/testing/__tests__
 */
import type { ExchangeRateProviderPort } from '../../domain/ports/exchange-rate-provider.port';
import { ContractSubjectMissingError } from '../contract-result.types';
import {
  PUBLICATION_DAY_CONTRACT_CASE_IDS,
  PUBLICATION_DAY_CONTRACT_DATES,
  checkPublicationDayContract,
  providerDeclaresPublicationDayResolution,
} from '../publication-day-contract.suite';
import type {
  PublicationDayContractCaseId,
  PublicationDayContractFixtures,
} from '../publication-day-contract.suite';

/** The answer a conforming, ECB-shaped provider gives for every candidate. */
const CORRECT_ANSWERS: Readonly<Record<string, string>> = {
  [PUBLICATION_DAY_CONTRACT_DATES.weekday]: PUBLICATION_DAY_CONTRACT_DATES.weekday,
  [PUBLICATION_DAY_CONTRACT_DATES.saturday]: PUBLICATION_DAY_CONTRACT_DATES.fridayBeforeWeekend,
  [PUBLICATION_DAY_CONTRACT_DATES.sunday]: PUBLICATION_DAY_CONTRACT_DATES.fridayBeforeWeekend,
  // ECB-shaped: no Polish-calendar dependency, so this holiday is unchanged.
  [PUBLICATION_DAY_CONTRACT_DATES.corpusChristi2026]: PUBLICATION_DAY_CONTRACT_DATES.corpusChristi2026,
};

const FIXTURES: PublicationDayContractFixtures = {
  weekdayExpected: PUBLICATION_DAY_CONTRACT_DATES.weekday,
  saturdayExpected: PUBLICATION_DAY_CONTRACT_DATES.fridayBeforeWeekend,
  sundayExpected: PUBLICATION_DAY_CONTRACT_DATES.fridayBeforeWeekend,
  corpusChristi2026Expected: PUBLICATION_DAY_CONTRACT_DATES.corpusChristi2026,
};

/** A minimal, otherwise-unused base so `ContractSubjectMissingError` never fires. */
function baseMembers(): Pick<
  ExchangeRateProviderPort,
  'name' | 'pivotCurrency' | 'supports' | 'listSupportedCurrencies' | 'fetchRate'
> {
  return {
    name: 'ecb',
    pivotCurrency: 'EUR',
    supports: () => true,
    listSupportedCurrencies: () => ['EUR'],
    fetchRate: () => Promise.reject(new Error('not exercised by this suite')),
  };
}

/** A provider that answers every candidate correctly. */
function conformingProvider(): ExchangeRateProviderPort {
  return {
    ...baseMembers(),
    resolveExpectedPublicationDay: (candidate: string) => CORRECT_ANSWERS[candidate] ?? candidate,
  };
}

/**
 * A provider correct everywhere EXCEPT for the one candidate named in
 * `wrongAnswers` - each entry breaks exactly one contract case, which is
 * what makes it a valid mutation fixture for the declared-vs-covered
 * assertion below (the discipline `docs/testing-guide.md § Port-contract
 * suites` calls "assert each fixture fails its OWN case plus only the
 * collateral it declares").
 */
function brokenProvider(wrongAnswers: Readonly<Record<string, string>>): ExchangeRateProviderPort {
  return {
    ...baseMembers(),
    resolveExpectedPublicationDay: (candidate: string) =>
      wrongAnswers[candidate] ?? CORRECT_ANSWERS[candidate] ?? candidate,
  };
}

/**
 * One deliberately-broken provider per declared case id. `contract-coverage`
 * below asserts this set's keys equal `PUBLICATION_DAY_CONTRACT_CASE_IDS`
 * exactly, failing on EITHER side - the primary anti-vacuity guard.
 */
const NON_CONFORMING_PROVIDERS: Record<PublicationDayContractCaseId, ExchangeRateProviderPort> = {
  'weekday-resolves-to-itself': brokenProvider({
    // Shifted back a day - wrong ONLY for the weekday case; the weekend
    // cases already expect a shift and Corpus Christi is untouched.
    [PUBLICATION_DAY_CONTRACT_DATES.weekday]: '2026-08-12',
  }),
  'saturday-resolves-to-preceding-friday': brokenProvider({
    // Left unchanged rather than walked back - a provider that forgot
    // weekends are never publication days.
    [PUBLICATION_DAY_CONTRACT_DATES.saturday]: PUBLICATION_DAY_CONTRACT_DATES.saturday,
  }),
  'sunday-resolves-to-preceding-friday': brokenProvider({
    [PUBLICATION_DAY_CONTRACT_DATES.sunday]: PUBLICATION_DAY_CONTRACT_DATES.sunday,
  }),
  'corpus-christi-2026-06-04-divergence': brokenProvider({
    // The exact bug the case exists to catch: a Polish-calendar-shaped
    // walk-back past a holiday ECB does not observe.
    [PUBLICATION_DAY_CONTRACT_DATES.corpusChristi2026]: '2026-06-03',
  }),
};

describe('publication-day contract - coverage', () => {
  it('should declare at least one contract case', () => {
    // A suite pointed at nothing must never read as a short green run.
    expect(PUBLICATION_DAY_CONTRACT_CASE_IDS.length).toBeGreaterThan(0);
  });

  it('should have a non-conforming fixture for every declared case, and no orphan fixture', () => {
    const declared = [...PUBLICATION_DAY_CONTRACT_CASE_IDS].sort();
    const covered = Object.keys(NON_CONFORMING_PROVIDERS).sort();
    expect(covered).toEqual(declared);
  });

  it('should pass every case for a conforming provider', () => {
    const result = checkPublicationDayContract(conformingProvider(), FIXTURES);
    expect(result.cases.map((c) => c.id).sort()).toEqual([...PUBLICATION_DAY_CONTRACT_CASE_IDS].sort());
    for (const contractCase of result.cases) {
      expect({ id: contractCase.id, failures: contractCase.failures }).toEqual({
        id: contractCase.id,
        failures: [],
      });
      expect(contractCase.checks).toBeGreaterThan(0);
    }
  });

  it.each(PUBLICATION_DAY_CONTRACT_CASE_IDS)(
    'should fail ONLY "%s" for its own non-conforming fixture',
    (targetId) => {
      const result = checkPublicationDayContract(NON_CONFORMING_PROVIDERS[targetId], FIXTURES);
      const failingIds = result.cases.filter((c) => c.failures.length > 0).map((c) => c.id);
      expect(failingIds).toEqual([targetId]);
    }
  );

  it('should report a throwing case as a failure rather than swallowing it', () => {
    const exploding: ExchangeRateProviderPort = {
      ...baseMembers(),
      resolveExpectedPublicationDay: () => {
        throw new Error('boom');
      },
    };

    const result = checkPublicationDayContract(exploding, FIXTURES);
    const withFailures = result.cases.filter((c) => c.failures.length > 0);
    expect(withFailures.length).toBe(result.cases.length);
  });
});

describe('publication-day contract - optional-method absence, asserted in both directions', () => {
  it('should recognise a provider that omits the method as NOT declaring it', () => {
    const provider: ExchangeRateProviderPort = { ...baseMembers() };

    expect(providerDeclaresPublicationDayResolution(provider)).toBe(false);

    const result = checkPublicationDayContract(provider, FIXTURES);
    expect(result.cases).toEqual([]);
  });

  it('should recognise a NON-FUNCTION property as absent, never trust the shape', () => {
    // The ADR-046 probe-not-trust rule this suite exists to enforce: a
    // provider carrying the key but not a callable must be read exactly
    // like one that omits it entirely.
    const provider = {
      ...baseMembers(),
      resolveExpectedPublicationDay: 'not-a-function',
    } as unknown as ExchangeRateProviderPort;

    expect(providerDeclaresPublicationDayResolution(provider)).toBe(false);

    const result = checkPublicationDayContract(provider, FIXTURES);
    expect(result.cases).toEqual([]);
  });

  it('should recognise a conforming provider as declaring the method', () => {
    expect(providerDeclaresPublicationDayResolution(conformingProvider())).toBe(true);
  });
});

describe('publication-day contract - vacuity guards', () => {
  it('should throw, not skip, when no subject is given', () => {
    expect(() =>
      checkPublicationDayContract(undefined as unknown as ExchangeRateProviderPort, FIXTURES)
    ).toThrow(ContractSubjectMissingError);
  });

  it('should throw when the subject does not implement the base port', () => {
    expect(() =>
      checkPublicationDayContract(
        { name: 'ecb' } as unknown as ExchangeRateProviderPort,
        FIXTURES
      )
    ).toThrow(ContractSubjectMissingError);
  });
});
