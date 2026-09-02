/**
 * Port-contract run results (#2404, `W3a-15`)
 *
 * The shapes the PURE half of a port-contract suite answers in, plus the two
 * structural faults it refuses rather than reports.
 *
 * ## Why a result type at all
 *
 * The two contract suites this repo already ships —
 * `runKsefHttpClientContract` and `runSubiektBridgeContractTests` — are
 * jest-coupled throughout: every rule lives inside an `it`. That is fine for
 * running them and useless for asking the question #2404 exists to ask, which
 * is **"did this suite actually assert anything?"**. A jest-coupled suite can
 * only answer it from inside jest, where an `it` that asserts nothing is
 * indistinguishable from one that passes.
 *
 * Splitting the rules into a pure function that returns these shapes makes the
 * question an ordinary unit test. That is the whole reason this file exists.
 *
 * ## The two faults are THROWN, never reported
 *
 * A missing subject and an empty case table are not contract failures — they
 * are the suite being unable to say anything at all. Reporting them as a result
 * would let a caller render "0 failures" over them, which is the #2673 shape:
 * "not covered" and "covered and passing" collapsing into one green reading.
 * They abort instead.
 *
 * @module libs/core/src/fulfillment/testing
 * @see docs/plans/implementation-plan-port-contract-test-kit.md §4
 */

/** One contract case's outcome. */
export interface ContractCaseResult {
  readonly id: string;
  /**
   * How many comparisons the case actually made.
   *
   * Incremented ONLY by `ContractCaseRecorder.check`, which requires a boolean
   * condition and a failure message — so a case cannot raise this without
   * evaluating something. That makes it meaningfully harder to game than a bare
   * counter, but it is still SELF-REPORTED and is therefore the secondary
   * guard: `check(true, '…')` would pass it. The primary guard is the
   * declared-vs-covered mutation-fixture assertion in
   * `__tests__/contract-coverage.spec.ts`.
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
 * passes because it found no subject is the exact defect #2404 is about.
 */
export class ContractSubjectMissingError extends Error {
  constructor(
    public readonly contractName: string,
    public readonly detail: string,
  ) {
    super(
      `${contractName} was given no usable subject: ${detail}. ` +
        'A contract suite with no subject must fail, never skip.',
    );
    this.name = 'ContractSubjectMissingError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Raised when a contract suite declares no cases.
 *
 * An empty case table passes trivially and forever. Refusing it is what stops a
 * future refactor from gutting the rules and leaving a green suite behind.
 */
export class EmptyContractSuiteError extends Error {
  constructor(public readonly contractName: string) {
    super(
      `${contractName} declares no contract cases. ` +
        'An empty contract suite asserts nothing and must fail.',
    );
    this.name = 'EmptyContractSuiteError';
    Error.captureStackTrace(this, this.constructor);
  }
}
