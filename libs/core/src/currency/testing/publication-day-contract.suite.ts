/**
 * `ExchangeRateProviderPort.resolveExpectedPublicationDay` contract suite
 * (#2800 review, finding 2)
 *
 * One suite every implementer of the OPTIONAL `resolveExpectedPublicationDay`
 * member must pass. The port's own docblock states an asymmetric guarantee
 * (erring late is free, erring early corrupts a stamp - see
 * `exchange-rate-provider.port.ts`) whose violation is SILENT: a too-early
 * answer produces a plausible, wrong rate on a financial figure with no
 * exception anywhere. A contract whose violation cannot be observed at the
 * call site is exactly the case for binding every implementer to one shared
 * suite rather than trusting each one's own hand-written spec to keep
 * re-deriving the same rules correctly.
 *
 * ## Shape: a PURE checker plus a thin jest wrapper
 *
 * Follows `libs/core/src/fulfillment/testing`'s discipline (#2404), the
 * repo's precedent for a suite that must answer "did this actually assert
 * anything?" from OUTSIDE jest: `checkPublicationDayContract` names no jest
 * global and answers in `ContractRunResult`; `runPublicationDayContract` is
 * the thin jest entry point. Scaled down from that kit deliberately - this
 * port has exactly one optional method and three implementers (NBP, ECB, the
 * fake), against the fulfilment kit's several ports and many-case suites, so
 * one suite file plus one coverage spec is proportionate; a second
 * `contract-vacuity.spec.ts` file was judged unnecessary ceremony and its
 * assertions folded into the coverage spec instead.
 *
 * ## The optional method, handled by ABSENCE asserted in both directions
 *
 * `resolveExpectedPublicationDay` is OPTIONAL (ADR-046 probe-not-trust
 * pattern), so a provider that declares nothing is conforming, not broken.
 * The obvious handling is `it.skip` for such a provider, and it is exactly
 * the defect this kit exists to avoid: a skipped case reads green and
 * asserts nothing, so a provider whose probe is silently mis-wired (e.g. the
 * method exists but is not a function) would be indistinguishable from one
 * that genuinely declares nothing. `providerDeclaresPublicationDayResolution`
 * is the ONE function both the checker and the wrapper call to decide
 * applicability, so what is REPORTED and what is ENFORCED cannot drift (the
 * #2229 rule) - and the wrapper's first assertion is that this function's
 * answer matches what the caller declared it expects, so a mis-detected
 * probe fails loudly rather than silently running (or skipping) the wrong
 * set of cases.
 *
 * ## Every rule cites the declaration it rests on
 *
 * A rule with no source in `libs/core` is not shipped - a mirror stricter
 * than the contract refuses behaviour the port would have accepted (#2240).
 * Each case below names the docblock sentence it enforces.
 *
 * ## Every case's EXPECTED answer is supplied by the caller, on purpose
 *
 * The port's own guarantee - "no publication day lies in `(returned,
 * candidate]`" - is trivially satisfied by returning the candidate
 * UNCHANGED on every call: the interval `(x, x]` is always empty, whatever
 * `x` is. So "always answer the candidate" is a legal, safe, conforming
 * implementation of this method for ANY input - it is exactly the "when in
 * doubt, return the candidate" branch the port docblock names, and it is
 * what `FakeExchangeRateAdapter` deliberately does (it has no publication
 * calendar to consult). Hardcoding "a Saturday MUST resolve to the
 * preceding Friday" as a universal requirement would therefore be a mirror
 * STRICTER than the contract itself - refusing a conforming implementation
 * the port would accept (#2240's rule, applied here rather than to a
 * destination gate). So every candidate/expected pair is supplied by the
 * fixture the caller passes to `checkPublicationDayContract` /
 * `runPublicationDayContract`: NBP and ECB supply the real walked-back
 * answers their calendars compute (proving the OPTIMIZATION works
 * correctly when attempted), and the fake supplies its own honest identity
 * answers (proving the SAFETY invariant - `resolved <= candidate`,
 * synchronous, no I/O - holds even for the maximally conservative
 * implementation). `PUBLICATION_DAY_CONTRACT_REAL_CALENDAR_FIXTURES` is the
 * shared preset the two real adapters both use for the three universal
 * dates; only the Corpus Christi divergence differs between them and is
 * supplied separately per spec.
 *
 * @module libs/core/src/currency/testing
 */
import type { ExchangeRateProviderPort } from '../domain/ports/exchange-rate-provider.port';
import {
  ContractSubjectMissingError,
  EmptyContractSuiteError,
} from './contract-result.types';
import type {
  ContractCaseRecorder,
  ContractCaseResult,
  ContractRunResult,
} from './contract-result.types';

const CONTRACT_NAME = 'ExchangeRateProviderPort.resolveExpectedPublicationDay contract';

/**
 * Fixed calendar dates the three UNIVERSAL cases run against. Chosen to be
 * uncontroversial for any conforming implementer: no PL public holiday and no
 * ECB TARGET closing sits anywhere near them, so a Polish-calendar adapter and
 * a weekend-only adapter agree on every one of them. The same dates already
 * back the shipped NBP/ECB hand-written specs (kept, not duplicated).
 */
export const PUBLICATION_DAY_CONTRACT_DATES = {
  /** Thursday - an ordinary business day for both PL and TARGET calendars. */
  weekday: '2026-08-13',
  saturday: '2026-08-15',
  sunday: '2026-08-16',
  /** The Friday both a Saturday and a Sunday candidate above resolve to. */
  fridayBeforeWeekend: '2026-08-14',
  /**
   * Thursday, a genuine PL public holiday and an ordinary ECB publication
   * day - the date NBP and ECB are DESIGNED to answer differently for. See
   * the file header "Every case's EXPECTED answer is supplied by the
   * caller, on purpose".
   */
  corpusChristi2026: '2026-06-04',
} as const;

/** The declared case table - see `docs/testing-guide.md § Port-contract suites`. */
export const PUBLICATION_DAY_CONTRACT_CASE_IDS = [
  'weekday-resolves-to-itself',
  'saturday-resolves-to-preceding-friday',
  'sunday-resolves-to-preceding-friday',
  'corpus-christi-2026-06-04-divergence',
] as const;

export type PublicationDayContractCaseId = (typeof PUBLICATION_DAY_CONTRACT_CASE_IDS)[number];

/**
 * The per-implementer expected answer for every case. See the file header
 * "Every case's EXPECTED answer is supplied by the caller, on purpose" for
 * why none of these is hardcoded in the suite.
 */
export interface PublicationDayContractFixtures {
  readonly weekdayExpected: string;
  readonly saturdayExpected: string;
  readonly sundayExpected: string;
  readonly corpusChristi2026Expected: string;
}

/**
 * The answers a REAL calendar-aware implementer (NBP, ECB) gives for the
 * three UNIVERSAL dates - no shipped or plausible source legitimately
 * disagrees that an ordinary weekday is itself or that a plain weekend with
 * no adjacent holiday resolves to the preceding Friday. Spread this and
 * override `corpusChristi2026Expected`, the one date NBP and ECB are
 * DESIGNED to answer differently for (see `CONTRACT_CASES`'s own case
 * below).
 */
export const PUBLICATION_DAY_CONTRACT_REAL_CALENDAR_FIXTURES: Pick<
  PublicationDayContractFixtures,
  'weekdayExpected' | 'saturdayExpected' | 'sundayExpected'
> = {
  weekdayExpected: PUBLICATION_DAY_CONTRACT_DATES.weekday,
  saturdayExpected: PUBLICATION_DAY_CONTRACT_DATES.fridayBeforeWeekend,
  sundayExpected: PUBLICATION_DAY_CONTRACT_DATES.fridayBeforeWeekend,
};

/**
 * ADR-046 probe-not-trust: tests for the METHOD, never the type. An
 * out-of-tree provider compiled against an older `libs/core` would satisfy a
 * widened type guard without implementing the method, so a type-level check
 * would silently misclassify it. The ONE decision point both
 * `checkPublicationDayContract` and `runPublicationDayContract` call, so a
 * mis-probe cannot report one applicability and enforce another.
 */
export function providerDeclaresPublicationDayResolution(
  provider: Pick<ExchangeRateProviderPort, 'resolveExpectedPublicationDay'>
): boolean {
  return typeof provider.resolveExpectedPublicationDay === 'function';
}

interface MutableCaseResult {
  id: PublicationDayContractCaseId;
  checks: number;
  failures: string[];
}

function createRecorder(into: MutableCaseResult): ContractCaseRecorder {
  return {
    check(condition: boolean, failureMessage: string): void {
      into.checks += 1;
      if (!condition) {
        into.failures.push(failureMessage);
      }
    },
  };
}

type ContractCase = (
  provider: ExchangeRateProviderPort,
  fixtures: PublicationDayContractFixtures,
  record: ContractCaseRecorder
) => void;

/**
 * Shared assertion body for every case: the method must answer SYNCHRONOUSLY
 * with a day `<=` candidate, equal to `expected`.
 *
 * SOURCE: the port docblock - "Pure, synchronous, no I/O" and "A day <=
 * `candidate`...". The synchronicity check exists because a non-conforming
 * plugin can return a `Promise` at runtime regardless of what the TypeScript
 * signature promises; `resolved <= candidate` is the structural half of the
 * contract's own guarantee, checked independently of the exact-match
 * assertion so a too-early OR too-late wrong answer is named precisely.
 */
function assertResolution(
  record: ContractCaseRecorder,
  provider: ExchangeRateProviderPort,
  candidate: string,
  expected: string,
  label: string
): void {
  // Guarded by the caller (`checkPublicationDayContract` only runs these
  // cases when the probe already found the method), so this is a defensive
  // cast rather than a second check of applicability.
  const resolved = provider.resolveExpectedPublicationDay!(candidate);

  record.check(
    typeof resolved === 'string',
    `resolveExpectedPublicationDay(${candidate}) [${label}] did not return a string ` +
      `synchronously (got ${JSON.stringify(resolved)}) - the port requires "pure, ` +
      'synchronous, no I/O"'
  );
  if (typeof resolved !== 'string') {
    return;
  }

  record.check(
    resolved <= candidate,
    `resolveExpectedPublicationDay(${candidate}) [${label}] returned ${resolved}, which is ` +
      'AFTER the candidate - the port requires a day <= candidate'
  );

  record.check(
    resolved === expected,
    `resolveExpectedPublicationDay(${candidate}) [${label}] returned ${resolved}, expected ${expected}`
  );
}

const CONTRACT_CASES: Record<PublicationDayContractCaseId, ContractCase> = {
  /**
   * SOURCE: "an implementer in doubt returns the candidate" - an ordinary
   * weekday is never in doubt for any shipped or plausible source, so a
   * conforming provider must answer with the candidate itself here even
   * though the safety branch below would technically also permit any
   * unchanged answer (see the file header) - the fixture pins each
   * provider to the SPECIFIC answer it claims to give.
   */
  'weekday-resolves-to-itself': (provider, fixtures, record) => {
    assertResolution(
      record,
      provider,
      PUBLICATION_DAY_CONTRACT_DATES.weekday,
      fixtures.weekdayExpected,
      'an ordinary weekday'
    );
  },

  /**
   * SOURCE: "erring late is free... no source publishes on Saturday/Sunday".
   * A provider MAY conform by returning the Saturday unchanged (the "when in
   * doubt" branch), so this case does not universally require the Friday
   * answer - it verifies the provider gives the answer IT claims to give,
   * via `fixtures.saturdayExpected`.
   */
  'saturday-resolves-to-preceding-friday': (provider, fixtures, record) => {
    assertResolution(
      record,
      provider,
      PUBLICATION_DAY_CONTRACT_DATES.saturday,
      fixtures.saturdayExpected,
      'a Saturday candidate'
    );
  },

  /** SOURCE: same as the Saturday case, the other weekend day. */
  'sunday-resolves-to-preceding-friday': (provider, fixtures, record) => {
    assertResolution(
      record,
      provider,
      PUBLICATION_DAY_CONTRACT_DATES.sunday,
      fixtures.sundayExpected,
      'a Sunday candidate'
    );
  },

  /**
   * SOURCE: the port docblock's asymmetry paragraph, verified live against
   * ECB (see `ecb-exchange-rate.adapter.ts`'s class header and its own
   * `resolveExpectedPublicationDay` hand-written spec case, kept
   * verbatim): a Polish-calendar-shaped walk-back would resolve this
   * Thursday back to Wednesday 2026-06-03, silently stamping the wrong
   * published rate for any provider - like ECB - whose own calendar does
   * NOT observe this holiday. The expected value is supplied per-provider
   * because it is the one date NBP and ECB are DESIGNED to answer
   * differently for - see the file header.
   */
  'corpus-christi-2026-06-04-divergence': (provider, fixtures, record) => {
    assertResolution(
      record,
      provider,
      PUBLICATION_DAY_CONTRACT_DATES.corpusChristi2026,
      fixtures.corpusChristi2026Expected,
      'the Corpus Christi 2026-06-04 divergence'
    );
  },
};

/**
 * Run every APPLICABLE contract rule against `provider` and report per-case
 * results.
 *
 * Pure of jest: names no `describe`, `it` or `expect`, so it is callable from
 * any runner and, more importantly, is itself testable.
 *
 * A provider that does not declare `resolveExpectedPublicationDay` is
 * CONFORMING, not a subject fault: `cases` comes back empty and `subject`
 * still names it, rather than throwing. See the file header "handled by
 * ABSENCE asserted in both directions".
 *
 * @throws ContractSubjectMissingError when there is no usable subject at all
 * (missing, or missing the base port's required members).
 * @throws EmptyContractSuiteError when the suite's own DECLARED case table
 * is empty - a suite-authoring bug, never a legitimate per-subject outcome.
 */
export function checkPublicationDayContract(
  provider: ExchangeRateProviderPort,
  fixtures: PublicationDayContractFixtures,
  options: { readonly subject?: string } = {}
): ContractRunResult {
  if (provider === null || provider === undefined) {
    throw new ContractSubjectMissingError(CONTRACT_NAME, 'no provider was given');
  }
  if (typeof provider.supports !== 'function' || typeof provider.fetchRate !== 'function') {
    throw new ContractSubjectMissingError(
      CONTRACT_NAME,
      'the subject does not implement the base ExchangeRateProviderPort'
    );
  }
  if ((PUBLICATION_DAY_CONTRACT_CASE_IDS.length as number) === 0) {
    throw new EmptyContractSuiteError(CONTRACT_NAME);
  }

  const applicable = providerDeclaresPublicationDayResolution(provider)
    ? PUBLICATION_DAY_CONTRACT_CASE_IDS
    : ([] as readonly PublicationDayContractCaseId[]);

  const cases: ContractCaseResult[] = [];
  for (const id of applicable) {
    const result: MutableCaseResult = { id, checks: 0, failures: [] };
    try {
      CONTRACT_CASES[id](provider, fixtures, createRecorder(result));
    } catch (error) {
      // A throwing case is a FAILURE, never a silent pass.
      result.failures.push(`case threw: ${(error as Error).message}`);
    }
    cases.push({ id: result.id, checks: result.checks, failures: result.failures });
  }

  return { subject: options.subject ?? provider.name ?? 'provider', cases };
}

/**
 * Jest entry point.
 *
 * `expectDeclared` is REQUIRED, never defaulted: a caller must say which
 * branch it is asserting, so a mis-wired probe fails the very first
 * assertion ("recognises the optional method...") rather than silently
 * running zero cases and reading green.
 */
export function runPublicationDayContract(
  makeProvider: () => ExchangeRateProviderPort,
  fixtures: PublicationDayContractFixtures,
  options: { readonly subject?: string; readonly expectDeclared: boolean }
): void {
  describe(`${CONTRACT_NAME}${options.subject ? ` - ${options.subject}` : ''}`, () => {
    let provider: ExchangeRateProviderPort;
    let result: ContractRunResult;

    beforeAll(() => {
      provider = makeProvider();
      result = checkPublicationDayContract(provider, fixtures, options);
    });

    it('should recognise the optional method as declared or absent, never silently skip', () => {
      expect(providerDeclaresPublicationDayResolution(provider)).toBe(options.expectDeclared);
    });

    const expectedIds: readonly PublicationDayContractCaseId[] = options.expectDeclared
      ? PUBLICATION_DAY_CONTRACT_CASE_IDS
      : [];

    it('runs exactly the applicable contract cases', () => {
      expect(result.cases.map((c) => c.id).sort()).toEqual([...expectedIds].sort());
    });

    for (const id of expectedIds) {
      it(id, () => {
        const found = result.cases.find((c) => c.id === id);
        expect(found).toBeDefined();
        expect(found?.failures ?? ['case did not run']).toEqual([]);
        expect(found?.checks ?? 0).toBeGreaterThan(0);
      });
    }
  });
}
