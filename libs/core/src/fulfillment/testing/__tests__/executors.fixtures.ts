/**
 * Executor contract fixtures — one conforming executor, and one deliberate
 * breakage per declared contract case (#2404, `W3a-15`)
 *
 * These exist to answer the only question that makes a contract suite worth
 * anything: **can it fail?** A suite verified solely against a conforming subject
 * is indistinguishable from a suite that asserts nothing.
 *
 * `NON_CONFORMING_EXECUTORS` is keyed by the case id each fixture targets, and
 * `executor-contract-coverage.spec.ts` asserts that key set EQUALS the union of
 * the base and status-source case tables. So a case added to the suite without a
 * fixture proving it can fail is a build failure, not a silently uncovered rule.
 *
 * ## Every status fixture is itself a status source
 *
 * A `status/*` fixture that failed to implement `FulfillmentStatusSource` would
 * not have its case RUN at all, and "fails its own case" would be vacuously
 * false. The spec would catch that (the failing set would not contain the
 * target), which is precisely why applicability is asserted rather than assumed.
 *
 * ## `expectedCollateral`
 *
 * Each fixture declares the OTHER cases its breakage necessarily also fails, and
 * the spec asserts the failing set is exactly `[target, ...expectedCollateral]`.
 * Declaring collateral is stricter than tolerating it: "at least the target
 * failed" would pass a fixture that broke everything, which proves nothing about
 * the target rule.
 *
 * @module libs/core/src/fulfillment/testing/__tests__
 */
import type { FulfillmentStatusSource } from '../../domain/ports/capabilities/fulfillment-status-source.capability';
import type { FulfillmentExecutorPort } from '../../domain/ports/fulfillment-executor.port';
import type {
  FulfillmentProgressSnapshot,
  FulfillmentRequestResult,
} from '../../domain/types/fulfillment-execution.types';
import { FULFILLMENT_EXECUTOR_CONTRACT_WORK } from '../fulfillment-executor-contract.suite';
import type { FulfillmentExecutorContractCaseId } from '../fulfillment-executor-contract.suite';

const ACCEPTED_AT = new Date('2026-08-31T09:00:00.000Z');
const OBSERVED_AT = new Date('2026-08-31T10:00:00.000Z');

function conformingSnapshot(): FulfillmentProgressSnapshot {
  return {
    work: FULFILLMENT_EXECUTOR_CONTRACT_WORK,
    externalWorkId: 'holder-ref-1',
    lines: [{ workLineId: 'work-line-1', fulfilledQuantity: 1, cancelledQuantity: 0 }],
    observedAt: OBSERVED_AT,
  };
}

/** An executor that satisfies every base rule and implements no status source. */
export class ConformingExecutor implements FulfillmentExecutorPort {
  requestFulfillment(): Promise<FulfillmentRequestResult> {
    return Promise.resolve({ status: 'accepted', externalWorkId: 'holder-ref-1', acceptedAt: ACCEPTED_AT });
  }

  requestCancellation(): Promise<FulfillmentRequestResult> {
    return Promise.resolve({ status: 'rejected', reason: 'already_picked', blocking: false, detail: null });
  }
}

/** The same, plus a conforming pull-shaped progress read. */
export class ConformingStatusSourceExecutor
  extends ConformingExecutor
  implements FulfillmentStatusSource
{
  getWorkFulfillmentStatus(): Promise<FulfillmentProgressSnapshot> {
    return Promise.resolve(conformingSnapshot());
  }
}

/**
 * An executor that rejects — a perfectly conforming, expected outcome.
 *
 * Present so the rejection-shaped rules (`blocking`, the rejected allowlist) are
 * exercised on a PASSING subject too, not only through their breakages. A rule
 * only ever seen failing is a rule whose green reading is untested.
 */
export class ConformingRejectingExecutor implements FulfillmentExecutorPort {
  requestFulfillment(): Promise<FulfillmentRequestResult> {
    return Promise.resolve({ status: 'rejected', reason: 'no_stock', blocking: true, detail: 'Out of stock' });
  }

  requestCancellation(): Promise<FulfillmentRequestResult> {
    return Promise.resolve({ status: 'accepted', externalWorkId: null, acceptedAt: null });
  }
}

interface NonConformingExecutorFixture {
  readonly make: () => FulfillmentExecutorPort;
  readonly expectedCollateral: readonly FulfillmentExecutorContractCaseId[];
}

export const NON_CONFORMING_EXECUTORS: Record<
  FulfillmentExecutorContractCaseId,
  NonConformingExecutorFixture
> = {
  /** Mints a fresh holder reference per call, so a replay is not the original outcome. */
  'request/replays-original-outcome': {
    make: () => {
      let n = 0;
      return {
        requestFulfillment: () =>
          Promise.resolve({
            status: 'accepted' as const,
            externalWorkId: `holder-ref-${(n += 1)}`,
            acceptedAt: ACCEPTED_AT,
          }),
        requestCancellation: () =>
          Promise.resolve({
            status: 'accepted' as const,
            externalWorkId: null,
            acceptedAt: null,
          }),
      };
    },
    expectedCollateral: [],
  },

  /**
   * Answers a third status. Collateral is inherent: the arm-shaped rules can read
   * neither `blocking` nor `acceptedAt` off a status that is neither arm, and they
   * correctly say so rather than passing over it.
   */
  'request/result-status-recognised': {
    make: () =>
      ({
        requestFulfillment: () => Promise.resolve({ status: 'queued', externalWorkId: null, acceptedAt: null }),
        requestCancellation: () => Promise.resolve({ status: 'accepted', externalWorkId: null, acceptedAt: null }),
      }) as unknown as FulfillmentExecutorPort,
    expectedCollateral: [
      'request/result-fields-allowlisted',
      'request/rejection-declares-blocking',
      'request/holder-instant-not-invented',
    ],
  },

  /** Smuggles a field past the accepted arm's allowlist — the shape #2399 would persist. */
  'request/result-fields-allowlisted': {
    make: () =>
      ({
        requestFulfillment: () =>
          Promise.resolve({
            status: 'accepted',
            externalWorkId: 'holder-ref-1',
            acceptedAt: ACCEPTED_AT,
            vendorPayload: { buyerEmail: 'buyer@example.com' },
          }),
        requestCancellation: () => Promise.resolve({ status: 'accepted', externalWorkId: null, acceptedAt: null }),
      }) as unknown as FulfillmentExecutorPort,
    expectedCollateral: [],
  },

  /** Omits `blocking`, which reads `undefined` — falsy — and so never excludes the rejecter. */
  'request/rejection-declares-blocking': {
    make: () =>
      ({
        requestFulfillment: () => Promise.resolve({ status: 'rejected', reason: 'no_stock', detail: null }),
        requestCancellation: () => Promise.resolve({ status: 'accepted', externalWorkId: null, acceptedAt: null }),
      }) as unknown as FulfillmentExecutorPort,
    expectedCollateral: [],
  },

  /** Reports the instant as an ISO string — the JSON shape, not the declared `Date`. */
  'request/holder-instant-not-invented': {
    make: () =>
      ({
        requestFulfillment: () =>
          Promise.resolve({
            status: 'accepted',
            externalWorkId: 'holder-ref-1',
            acceptedAt: ACCEPTED_AT.toISOString(),
          }),
        requestCancellation: () => Promise.resolve({ status: 'accepted', externalWorkId: null, acceptedAt: null }),
      }) as unknown as FulfillmentExecutorPort,
    expectedCollateral: [],
  },

  /**
   * Answers `void` to a cancellation — the exact shape the port refuses, because it
   * would assert a compliance the contract cannot obtain.
   */
  'cancel/answers-recognised-result': {
    make: () =>
      ({
        requestFulfillment: () =>
          Promise.resolve({ status: 'accepted', externalWorkId: 'holder-ref-1', acceptedAt: ACCEPTED_AT }),
        requestCancellation: () => Promise.resolve(undefined),
      }) as unknown as FulfillmentExecutorPort,
    // The replay case compares two identical `undefined`s and passes; only the
    // shape rule can see the defect. That attribution is the point.
    expectedCollateral: [],
  },

  /**
   * Alternates refuse/comply on every call — a cancellation replay that is not
   * the original outcome.
   *
   * ALTERNATES rather than flipping once, and that is not cosmetic: every case in
   * a run shares ONE subject instance (an implementer passes one adapter), so
   * `cancel/answers-recognised-result` calls `requestCancellation` before this
   * case does. A flip-once fixture had both of THIS case's calls land on the
   * settled side and passed — a fixture that proved nothing, caught only because
   * the spec demands the target case actually fail. Alternating makes any two
   * consecutive calls differ, so the breakage is independent of case order.
   */
  'cancel/replays-original-outcome': {
    make: () => {
      let calls = 0;
      return {
        requestFulfillment: () =>
          Promise.resolve({ status: 'accepted' as const, externalWorkId: 'holder-ref-1', acceptedAt: ACCEPTED_AT }),
        requestCancellation: () => {
          calls += 1;
          return Promise.resolve(
            calls % 2 === 0
              ? { status: 'accepted' as const, externalWorkId: null, acceptedAt: null }
              : { status: 'rejected' as const, reason: 'already_picked', blocking: false, detail: null },
          );
        },
      };
    },
    expectedCollateral: [],
  },

  /** Answers about a different work object — progress #2400 would write to the wrong row. */
  'status/reports-the-work-it-was-asked-about': {
    make: () =>
      Object.assign(new ConformingExecutor(), {
        getWorkFulfillmentStatus: () =>
          Promise.resolve({ ...conformingSnapshot(), work: { workId: 'ol_fulfillmentwork_other', connectionId: 'x' } }),
      }),
    expectedCollateral: [],
  },

  /** A negative counter — not a count of things that happened. */
  'status/counters-well-formed': {
    make: () =>
      Object.assign(new ConformingExecutor(), {
        getWorkFulfillmentStatus: () =>
          Promise.resolve({
            ...conformingSnapshot(),
            lines: [{ workLineId: 'work-line-1', fulfilledQuantity: -1, cancelledQuantity: 0 }],
          }),
      }),
    expectedCollateral: [],
  },

  /** Smuggles a negotiation answer onto the progress read — a rival authority over #2399's column. */
  'status/carries-no-negotiation-status': {
    make: () =>
      Object.assign(new ConformingExecutor(), {
        getWorkFulfillmentStatus: () => Promise.resolve({ ...conformingSnapshot(), status: 'accepted' }),
      }),
    expectedCollateral: [],
  },

  /** Reports the observation instant as an epoch number. */
  'status/observation-instant-not-invented': {
    make: () =>
      Object.assign(new ConformingExecutor(), {
        getWorkFulfillmentStatus: () =>
          Promise.resolve({ ...conformingSnapshot(), observedAt: OBSERVED_AT.getTime() }),
      }),
    expectedCollateral: [],
  },
};
