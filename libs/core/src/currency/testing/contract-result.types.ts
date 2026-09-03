/**
 * Port-contract run results (#2800 review, finding 2)
 *
 * The shapes the PURE half of a port-contract suite answers in, plus the one
 * structural fault it refuses rather than reports.
 *
 * ## Why a result type at all
 *
 * A jest-coupled suite - every rule living inside an `it` - cannot answer
 * "did this suite actually assert anything?" from outside jest, where an `it`
 * that asserts nothing is indistinguishable from one that passes. Splitting
 * the rules into a pure function that returns these shapes makes the question
 * an ordinary unit test instead. This mirrors the shape `libs/core/src/
 * fulfillment/testing/contract-result.types.ts` established for #2404 - a
 * second, independent copy rather than a shared import, because `currency`
 * is a leaf context (see `docs/architecture-overview.md § 18 Currency`) and
 * must not depend on a sibling context's test-only barrel.
 *
 * ## The one fault is THROWN, never reported
 *
 * Being handed no usable subject is not a contract failure - it is the suite
 * being unable to say anything at all. Reporting it as a result would let a
 * caller render "0 failures" over it, which is the #2673 shape: "not
 * covered" and "covered and passing" collapsing into one green reading.
 *
 * @module libs/core/src/currency/testing
 */

/** One contract case's outcome. */
export interface ContractCaseResult {
  readonly id: string;
  /**
   * How many comparisons the case actually made.
   *
   * Incremented ONLY by `ContractCaseRecorder.check`, which requires a
   * boolean condition and a failure message - so a case cannot raise this
   * without evaluating something. That makes it meaningfully harder to game
   * than a bare counter, but it is still SELF-REPORTED and is therefore the
   * secondary guard: `check(true, '…')` would pass it. The primary guard is
   * the declared-vs-covered mutation-fixture assertion in
   * `__tests__/publication-day-contract.coverage.spec.ts`.
   */
  readonly checks: number;
  /** Human-readable reasons this case failed. Empty means it passed. */
  readonly failures: readonly string[];
}

/** Everything one contract run observed. */
export interface ContractRunResult {
  readonly subject: string;
  readonly cases: readonly ContractCaseResult[];
}

/** Recorder handed to a case body; the only way to register a comparison. */
export interface ContractCaseRecorder {
  check(condition: boolean, failureMessage: string): void;
}

/**
 * Raised when a contract suite is handed nothing to test.
 *
 * Thrown, not reported, and never degraded to a skip: a suite that quietly
 * passes because it found no subject is the exact defect this kit exists to
 * prevent.
 */
export class ContractSubjectMissingError extends Error {
  constructor(
    public readonly contractName: string,
    public readonly detail: string
  ) {
    super(
      `${contractName} was given no usable subject: ${detail}. ` +
        'A contract suite with no subject must fail, never skip.'
    );
    this.name = 'ContractSubjectMissingError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Raised when the suite's own DECLARED case table is empty.
 *
 * This is distinct from a per-subject run legitimately covering zero cases
 * (the optional-method-absent branch, see `publication-day-contract.suite.ts`)
 * - that is a normal, asserted outcome, not a suite bug. This error guards
 * the STATIC table `PUBLICATION_DAY_CONTRACT_CASE_IDS` itself: a future
 * refactor that gutted it to nothing would otherwise leave a suite that
 * passes trivially and forever.
 */
export class EmptyContractSuiteError extends Error {
  constructor(public readonly contractName: string) {
    super(
      `${contractName} declares no contract cases. ` +
        'An empty contract suite asserts nothing and must fail.'
    );
    this.name = 'EmptyContractSuiteError';
    Error.captureStackTrace(this, this.constructor);
  }
}
