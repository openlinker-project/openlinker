/**
 * `FulfillmentExecutorPort` contract suite (#2404, `W3a-15`)
 *
 * The second port this kit covers, and the sibling of
 * `fulfillment-router-contract.suite.ts`. #2393's router answers *"where is this
 * sourced from?"*; #2398's executor answers *"who is doing it, and did they take
 * it?"* — so each gets its own suite, in the shape design §9 asks for: one suite
 * every implementation must pass, binding the FIRST implementer to the contract
 * rather than letting the contract quietly become whatever that implementer did.
 *
 * ## Shape: a PURE checker plus a thin jest wrapper
 *
 * Identical to the router suite beside it, for the reason stated there:
 * `checkFulfillmentExecutorContract` names no jest global and answers in
 * `ContractRunResult`, so **"did this suite actually assert anything?"** is an
 * ordinary unit test rather than a question only answerable from inside jest.
 *
 * ## The optional sub-capability, and why it is NOT a skip
 *
 * `FulfillmentStatusSource` (#2398) is optional — a webhook-driven holder reports
 * progress inbound through #2400 and implements no pull-shaped read at all. The
 * obvious handling is `it.skip`, and it is exactly the defect this issue exists
 * to prevent: a skipped case reads green and asserts nothing, so an executor that
 * BROKE its status read would be indistinguishable from one that never had one.
 *
 * Instead, applicability is **structural and asserted in both directions**. The
 * status cases are appended to the declared table only when
 * `isFulfillmentStatusSource` narrows the subject, so a non-applicable case is
 * *absent from the report* rather than present-and-passing — and
 * `expectedFulfillmentExecutorContractCaseIds` is the single function that
 * decides, called by both the checker and the jest wrapper, so what is REPORTED
 * and what is ENFORCED cannot drift (the #2229 rule). `__tests__/` then asserts
 * both readings: a plain executor reports exactly the base ids and **no** status
 * id, and a status-source executor reports base ∪ status. Absence is therefore a
 * checked fact, not a silence.
 *
 * ## The suite observes the arm the subject CHOSE; it cannot force the other
 *
 * `requestFulfillment` answers `accepted` or `rejected` at the holder's
 * discretion and this suite has no injection point to make it do either. So the
 * two arm-shaped rules — `rejection-declares-blocking` and
 * `holder-instant-not-invented` — each do real work on ONE arm and record only
 * the arm check itself on the other. That is honest (a rule about a rejection
 * has nothing to say about an acceptance) but it means **running the suite once
 * does not prove both arms conform**: an executor that only ever accepts is
 * never asked whether its rejections declare `blocking`.
 *
 * The mitigation is to run the suite against a subject per arm, which is why
 * `__tests__/` ships `ConformingRejectingExecutor` beside `ConformingExecutor`
 * rather than testing the happy path alone. An implementer whose executor can
 * do both should do the same; a fixture is cheap and the alternative is a rule
 * that has never once been evaluated against the shape it is about.
 *
 * ## Every rule cites the declaration that supports it
 *
 * A rule with no source in `libs/core` is NOT shipped — a mirror stricter than
 * the gate refuses work the destination would have accepted (#2240). Note that
 * the issue text's `blocking` exclusion, which the ROUTER suite correctly dropped
 * because `FulfillmentRouterPort` has no such concept, is a real declared rule
 * *here* (`fulfillment-execution.types.ts` property (a)) and is asserted.
 *
 * ## Not asserted here, with reasons
 *
 * - **"never creates a second assignment".** The port states it; a contract suite
 *   handed only the port cannot observe a holder's internal assignment count. The
 *   OBSERVABLE half — a repeat under the same key returns the ORIGINAL outcome —
 *   is asserted, and the unobservable half is left to #2399, which owns the
 *   counter and can see the row.
 * - **`acceptedAt` being the HOLDER's instant rather than OL's** (property (e)).
 *   Two clocks cannot be told apart from outside. The checkable residue — that a
 *   reported instant is a real `Date` and an unreported one is `null`, never a
 *   string, a number or `undefined` — is asserted instead, and that is stated
 *   rather than dressed up as the full property.
 * - **`reason` vocabulary on a rejection.** Opaque by design (property (b));
 *   core does not enumerate it, so neither does this suite.
 * - **Per-method error unions and wall-clock budgets.** Deferred by the port
 *   itself to `W4-1` / `W4-2`. There is no declared timeout, so a wall-clock rule
 *   would be a flaky test measuring nothing.
 * - **`FULFILLMENT_REQUEST_ALLOWED_KEYS` on the inbound request.** That constant
 *   constrains what CORE SENDS, so the useful assertion belongs on the caller
 *   (#2399), not on the implementer this suite binds.
 *
 * @module libs/core/src/fulfillment/testing
 * @see docs/plans/implementation-plan-port-contract-test-kit.md
 */
import { assertFulfillmentRequestResultRecognised } from '../domain/exceptions/unrecognised-fulfillment-request-result.error';
import { isFulfillmentStatusSource } from '../domain/ports/capabilities/fulfillment-status-source.capability';
import type { FulfillmentExecutorPort } from '../domain/ports/fulfillment-executor.port';
import type {
  FulfillmentCancellationRequest,
  FulfillmentProgressSnapshot,
  FulfillmentRequest,
  FulfillmentRequestResult,
} from '../domain/types/fulfillment-execution.types';
import { FULFILLMENT_REQUEST_RESULT_ALLOWED_KEYS } from '../domain/types/fulfillment-execution.types';
import type { FulfillmentWorkRef } from '../domain/types/fulfillment-work.types';
import type {
  ContractCaseRecorder,
  ContractCaseResult,
  ContractRunResult,
} from './contract-result.types';
import {
  ContractSubjectMissingError,
  EmptyContractSuiteError,
} from './contract-result.types';

const CONTRACT_NAME = 'FulfillmentExecutorPort contract';

/**
 * Cases every executor must satisfy, whatever else it implements.
 *
 * `__tests__/executor-contract-coverage.spec.ts` asserts this set — unioned with
 * the status set below — equals the set of ids the non-conformance fixtures
 * target, failing on EITHER side. That equality is the primary anti-vacuity
 * guard: a case declared with no fixture proving it can fail would otherwise stay
 * green while covering nothing, which is the #2673 shape.
 */
export const FULFILLMENT_EXECUTOR_CONTRACT_CASE_IDS = [
  'request/replays-original-outcome',
  'request/result-status-recognised',
  'request/result-fields-allowlisted',
  'request/rejection-declares-blocking',
  'request/holder-instant-not-invented',
  'cancel/answers-recognised-result',
  'cancel/replays-original-outcome',
] as const;

/**
 * Cases that apply ONLY to an executor also implementing `FulfillmentStatusSource`.
 *
 * Kept a separate table rather than folded in with a runtime `if`, because the
 * separation is what lets `__tests__/` assert applicability in both directions
 * instead of trusting that an absent case was absent for the right reason.
 */
export const FULFILLMENT_STATUS_SOURCE_CONTRACT_CASE_IDS = [
  'status/reports-the-work-it-was-asked-about',
  'status/counters-well-formed',
  'status/carries-no-negotiation-status',
  'status/observation-instant-not-invented',
] as const;

export type FulfillmentExecutorContractCaseId =
  | (typeof FULFILLMENT_EXECUTOR_CONTRACT_CASE_IDS)[number]
  | (typeof FULFILLMENT_STATUS_SOURCE_CONTRACT_CASE_IDS)[number];

/**
 * Which cases this subject is answerable for.
 *
 * The ONE decision point, called by both `checkFulfillmentExecutorContract` and
 * `runFulfillmentExecutorContract`. Reported === enforced structurally: a wrapper
 * computing applicability by its own route could list a case the checker never
 * ran, which is the vacuity this suite is built against, one layer up.
 */
export function expectedFulfillmentExecutorContractCaseIds(
  executor: FulfillmentExecutorPort,
): readonly FulfillmentExecutorContractCaseId[] {
  return isFulfillmentStatusSource(executor)
    ? [
        ...FULFILLMENT_EXECUTOR_CONTRACT_CASE_IDS,
        ...FULFILLMENT_STATUS_SOURCE_CONTRACT_CASE_IDS,
      ]
    : [...FULFILLMENT_EXECUTOR_CONTRACT_CASE_IDS];
}

/** The work object every case requests, unless it needs a variant of it. */
export const FULFILLMENT_EXECUTOR_CONTRACT_WORK: FulfillmentWorkRef = Object.freeze({
  workId: 'ol_fulfillmentwork_contract_fixture',
  connectionId: '11111111-1111-1111-1111-111111111111',
});

/** The request every case offers, unless it needs a variant of it. */
export const FULFILLMENT_EXECUTOR_CONTRACT_REQUEST: FulfillmentRequest = Object.freeze({
  work: FULFILLMENT_EXECUTOR_CONTRACT_WORK,
  orderId: 'ol_order_contract_fixture',
  lines: Object.freeze([
    Object.freeze({
      workLineId: 'work-line-1',
      productVariantId: 'ol_variant_contract_1',
      quantity: 2,
    }),
  ]),
  shipTo: Object.freeze({
    mode: 'plain' as const,
    countryIso2: 'PL',
    postalCode: '00-001',
    city: 'Warszawa',
  }),
  deliveryMethod: null,
  idempotencyKey: 'work:ol_fulfillmentwork_contract_fixture:1',
}) as FulfillmentRequest;

const CANCELLATION_REQUEST: FulfillmentCancellationRequest = Object.freeze({
  work: FULFILLMENT_EXECUTOR_CONTRACT_WORK,
  // A real member of `FulfillmentCancellationReasonValues`, not a literal invented
  // here — the union is type-only across this leaf's barrel boundary, so a wrong
  // spelling would still type-check and quietly hand every subject a value core
  // does not use.
  reason: 'operator_forced',
  idempotencyKey: 'work:ol_fulfillmentwork_contract_fixture:1:cancel',
});

interface MutableCaseResult {
  id: FulfillmentExecutorContractCaseId;
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
  executor: FulfillmentExecutorPort,
  record: ContractCaseRecorder,
) => Promise<void>;

/**
 * Structural comparison of an outcome a repeated idempotency key must reproduce.
 *
 * `JSON.stringify` renders a `Date` as its ISO string and `undefined` as an
 * absent key, which is adequate here: a replay differing only in a value those
 * two collapse is a replay this contract does not distinguish, and the SHAPE
 * rules (`result-fields-allowlisted`, `holder-instant-not-invented`) hold those
 * axes separately.
 */
function outcomeBody(result: FulfillmentRequestResult): string {
  return JSON.stringify(result);
}

/** Keys this build recognises on the arm the executor answered with. */
function allowedKeysFor(result: FulfillmentRequestResult): readonly string[] {
  return result.status === 'accepted'
    ? FULFILLMENT_REQUEST_RESULT_ALLOWED_KEYS.accepted
    : FULFILLMENT_REQUEST_RESULT_ALLOWED_KEYS.rejected;
}

/**
 * Assert a result is one this build can act on, attributing an unrecognised
 * status to the calling case.
 *
 * Records a FAILURE rather than skipping: a status outside the two arms is
 * exactly what `assertFulfillmentRequestResultRecognised` refuses, and nothing in
 * this suite skips — a skip is how a suite reports nothing and still reads green.
 */
function recogniseResult(
  result: FulfillmentRequestResult,
  record: ContractCaseRecorder,
  method: string,
): boolean {
  let refusal: string | null = null;
  try {
    // Core's own refusal is the rule; this suite delegates to it rather than
    // restating the two arm names, which would be a second copy free to drift.
    assertFulfillmentRequestResultRecognised(result);
  } catch (error) {
    refusal = (error as Error).message;
  }

  record.check(
    refusal === null,
    `${method}() answered with a status this build cannot act on: ${refusal}`,
  );
  return refusal === null;
}

function checkResultFieldsAllowlisted(
  result: FulfillmentRequestResult,
  record: ContractCaseRecorder,
  method: string,
): void {
  const allowed = allowedKeysFor(result);
  const surplus = Object.keys(result).filter((key) => !allowed.includes(key));
  record.check(
    surplus.length === 0,
    `${method}() answered with fields outside the "${result.status}" allowlist: ` +
      `${surplus.join(', ')}. FULFILLMENT_REQUEST_RESULT_ALLOWED_KEYS bounds what core may persist ` +
      'from this result (#2399 stamps FulfillmentWork.requestStatus from it).',
  );
}

const CONTRACT_CASES: Record<FulfillmentExecutorContractCaseId, ContractCase> = {
  /**
   * SOURCE: `fulfillment-executor.port.ts` — "A repeat under the same key must
   * return the original outcome"; `fulfillment-execution.types.ts` property (d).
   *
   * Only the OBSERVABLE half of the stated guarantee. "must never create a second
   * assignment" is unobservable from outside the holder — see the file docblock.
   */
  'request/replays-original-outcome': async (executor, record) => {
    const first = await executor.requestFulfillment(FULFILLMENT_EXECUTOR_CONTRACT_REQUEST);
    const second = await executor.requestFulfillment(FULFILLMENT_EXECUTOR_CONTRACT_REQUEST);
    record.check(
      outcomeBody(first) === outcomeBody(second),
      'requestFulfillment() returned a different outcome for a repeated idempotency key ' +
        `(${outcomeBody(first)} then ${outcomeBody(second)}). The key's whole purpose is that a ` +
        're-request replays the original outcome rather than creating a second assignment.',
    );
  },

  /**
   * SOURCE: `assertFulfillmentRequestResultRecognised` — the build's runtime
   * refusal of any status outside the two declared arms (property (f): there is
   * deliberately no third arm, so an unrecognised one is refused, not modelled).
   */
  'request/result-status-recognised': async (executor, record) => {
    const result = await executor.requestFulfillment(FULFILLMENT_EXECUTOR_CONTRACT_REQUEST);
    recogniseResult(result, record, 'requestFulfillment');
  },

  /**
   * SOURCE: `FULFILLMENT_REQUEST_RESULT_ALLOWED_KEYS`, exported as DATA precisely
   * so the projection is bounded per ARM — `keyof (A | B)` is the INTERSECTION, so
   * one flat list would examine only `status` and pass whatever either arm grew.
   */
  'request/result-fields-allowlisted': async (executor, record) => {
    const result = await executor.requestFulfillment(FULFILLMENT_EXECUTOR_CONTRACT_REQUEST);
    checkResultFieldsAllowlisted(result, record, 'requestFulfillment');
  },

  /**
   * SOURCE: `fulfillment-execution.types.ts` property (a) — `blocking` is the
   * re-source loop terminator, and `undefined` is falsy, so an omitted value does
   * NOT exclude the rejecter and the infinite loop the field exists to prevent
   * runs anyway. A conforming executor must therefore answer a real boolean.
   *
   * An `accepted` result has no `blocking` and correctly registers no comparison
   * here beyond the arm check itself — which is why the arm check IS a comparison
   * rather than an early return: a case that records nothing is a case that ran
   * and asserted nothing.
   */
  'request/rejection-declares-blocking': async (executor, record) => {
    const result = await executor.requestFulfillment(FULFILLMENT_EXECUTOR_CONTRACT_REQUEST);
    if (result.status !== 'rejected') {
      record.check(
        result.status === 'accepted',
        `requestFulfillment() answered "${String(result.status)}", which is neither arm, so ` +
          'whether it declares `blocking` cannot be read.',
      );
      return;
    }
    record.check(
      typeof result.blocking === 'boolean',
      'A rejected result carried no boolean `blocking`. It is non-optional by design: ' +
        '`undefined` is falsy, so the rejecter would not be excluded from re-sourcing and the ' +
        'router would re-pick it forever.',
    );
  },

  /**
   * SOURCE: `fulfillment-execution.types.ts` property (e) — a holder-reported
   * instant is the HOLDER's, `null` when it reports none, "never `new Date()`".
   *
   * Two clocks cannot be told apart from outside, so this asserts the checkable
   * residue only: a reported instant is a real `Date`, an unreported one is
   * `null` — never a string, a number, or `undefined`.
   */
  'request/holder-instant-not-invented': async (executor, record) => {
    const result = await executor.requestFulfillment(FULFILLMENT_EXECUTOR_CONTRACT_REQUEST);
    if (result.status !== 'accepted') {
      record.check(
        result.status === 'rejected',
        `requestFulfillment() answered "${String(result.status)}", which is neither arm, so ` +
          'its reported instant cannot be read.',
      );
      return;
    }
    const { acceptedAt } = result;
    record.check(
      acceptedAt === null || acceptedAt instanceof Date,
      `An accepted result carried acceptedAt=${JSON.stringify(acceptedAt)}. It must be a Date ` +
        'the holder reported, or null when it reported none — never a string, a number or undefined.',
    );
  },

  /**
   * SOURCE: `fulfillment-executor.port.ts` property (a) — both methods answer with
   * the same type, because cancelling ALREADY-ACCEPTED work is a request the
   * holder may refuse. A `void` cancellation would assert a compliance the
   * contract cannot obtain.
   */
  'cancel/answers-recognised-result': async (executor, record) => {
    const result = await executor.requestCancellation(CANCELLATION_REQUEST);
    if (recogniseResult(result, record, 'requestCancellation')) {
      checkResultFieldsAllowlisted(result, record, 'requestCancellation');
    }
  },

  /**
   * SOURCE: `FulfillmentCancellationRequest.idempotencyKey` is mandatory, and the
   * port's replay guarantee is stated for the contract rather than for one method.
   */
  'cancel/replays-original-outcome': async (executor, record) => {
    const first = await executor.requestCancellation(CANCELLATION_REQUEST);
    const second = await executor.requestCancellation(CANCELLATION_REQUEST);
    record.check(
      outcomeBody(first) === outcomeBody(second),
      'requestCancellation() returned a different outcome for a repeated idempotency key ' +
        `(${outcomeBody(first)} then ${outcomeBody(second)}).`,
    );
  },

  /**
   * SOURCE: `getWorkFulfillmentStatus(workRef)` answers a
   * `FulfillmentProgressSnapshot` carrying its own `work`. A snapshot naming a
   * different work object is progress #2400 would write against the wrong row.
   */
  'status/reports-the-work-it-was-asked-about': async (executor, record) => {
    const snapshot = await readStatus(executor);
    record.check(
      snapshot.work?.workId === FULFILLMENT_EXECUTOR_CONTRACT_WORK.workId,
      `getWorkFulfillmentStatus() answered about work ${JSON.stringify(snapshot.work?.workId)} ` +
        `when asked about ${FULFILLMENT_EXECUTOR_CONTRACT_WORK.workId}.`,
    );
  },

  /**
   * SOURCE: `FulfillmentProgressSnapshot` — "Counters, never per-line statuses" —
   * for non-negativity read together with `checkFulfillmentWorkLineCapacity`,
   * which declares `>= 0` on the very counters this progress feeds.
   *
   * **Integrality is deliberately NOT asserted.** No declaration in `libs/core`
   * states it: the capacity rule tests `>= 0` and the fields are typed `number`.
   * A fractional count looks wrong, and refusing one would still be this suite
   * being stricter than the gate it mirrors — the #2240 failure, which is
   * precisely what this kit exists to prevent. Non-finite IS refused, because a
   * `NaN` satisfies neither `>= 0` nor its negation and would otherwise pass a
   * bare comparison silently.
   */
  'status/counters-well-formed': async (executor, record) => {
    const snapshot = await readStatus(executor);
    record.check(
      Array.isArray(snapshot.lines),
      'getWorkFulfillmentStatus() answered without a `lines` array.',
    );
    for (const line of snapshot.lines ?? []) {
      record.check(
        typeof line.workLineId === 'string' && line.workLineId.length > 0,
        `A progress line carried no workLineId: ${JSON.stringify(line)}.`,
      );
      for (const field of ['fulfilledQuantity', 'cancelledQuantity'] as const) {
        const value = line[field];
        record.check(
          typeof value === 'number' && Number.isFinite(value) && value >= 0,
          `Progress line ${String(line.workLineId)} carried ${field}=${JSON.stringify(value)}; ` +
            'a counter must be a finite, non-negative number (checkFulfillmentWorkLineCapacity ' +
            'declares >= 0 on the counters this feeds).',
        );
      }
    }
  },

  /**
   * SOURCE: `FulfillmentProgressSnapshot` — "It carries no negotiation status:
   * #2399 owns the accept handshake, and a second, poll-derived answer to 'did
   * they take it' would be a rival authority over the same column."
   */
  'status/carries-no-negotiation-status': async (executor, record) => {
    const snapshot = await readStatus(executor);
    const rival = ['status', 'requestStatus', 'accepted', 'rejected', 'blocking'].filter((key) =>
      Object.prototype.hasOwnProperty.call(snapshot, key),
    );
    record.check(
      rival.length === 0,
      `getWorkFulfillmentStatus() answered with negotiation field(s) ${rival.join(', ')}. ` +
        'Progress reports counters only; #2399 owns the accept handshake, and a poll-derived ' +
        'second answer would be a rival authority over the same column.',
    );
  },

  /** SOURCE: property (e), applied to `observedAt`. See the `request/` twin. */
  'status/observation-instant-not-invented': async (executor, record) => {
    const snapshot = await readStatus(executor);
    record.check(
      snapshot.observedAt === null || snapshot.observedAt instanceof Date,
      `getWorkFulfillmentStatus() carried observedAt=${JSON.stringify(snapshot.observedAt)}. ` +
        'It must be the holder\'s Date, or null when it reported none.',
    );
  },
};

/**
 * Read the optional status source.
 *
 * Only ever reached for a subject `expectedFulfillmentExecutorContractCaseIds`
 * already narrowed, so the throw is unreachable in a normal run and exists so a
 * mis-wired table surfaces as a named case failure rather than a `TypeError`
 * somewhere downstream.
 */
async function readStatus(
  executor: FulfillmentExecutorPort,
): Promise<FulfillmentProgressSnapshot> {
  if (!isFulfillmentStatusSource(executor)) {
    throw new Error(
      'A FulfillmentStatusSource case ran against an executor that does not implement it.',
    );
  }
  return executor.getWorkFulfillmentStatus(FULFILLMENT_EXECUTOR_CONTRACT_WORK);
}

/**
 * Run every applicable contract rule against one executor. PURE — no jest global.
 *
 * Throws on the two structural faults (no usable subject, empty case table)
 * rather than reporting them: those are the suite being unable to say anything at
 * all, and reporting them would let a caller render "0 failures" over them.
 */
export async function checkFulfillmentExecutorContract(
  executor: FulfillmentExecutorPort,
  subject = executor?.constructor?.name ?? 'unknown',
): Promise<ContractRunResult> {
  if (
    executor === null ||
    typeof executor !== 'object' ||
    typeof executor.requestFulfillment !== 'function' ||
    typeof executor.requestCancellation !== 'function'
  ) {
    throw new ContractSubjectMissingError(
      CONTRACT_NAME,
      'the subject does not implement requestFulfillment() and requestCancellation()',
    );
  }

  const caseIds = expectedFulfillmentExecutorContractCaseIds(executor);
  if (caseIds.length === 0) {
    throw new EmptyContractSuiteError(CONTRACT_NAME);
  }

  const cases: ContractCaseResult[] = [];
  for (const id of caseIds) {
    const result: MutableCaseResult = { id, checks: 0, failures: [] };
    try {
      await CONTRACT_CASES[id](executor, createRecorder(result));
    } catch (error) {
      // Recorded as a NAMED failure, never swallowed: a case that threw is a case
      // that did not finish, and it must not read as one that passed.
      result.failures.push(`case threw: ${(error as Error).message}`);
    }
    cases.push(result);
  }

  return { subject, cases };
}

/**
 * The jest entry point an implementation calls. Matches
 * `runFulfillmentRouterContract`, `runKsefHttpClientContract` and
 * `runSubiektBridgeContractTests`.
 */
export function runFulfillmentExecutorContract(
  makeExecutor: () => FulfillmentExecutorPort,
  options: { subject?: string } = {},
): void {
  describe(`${CONTRACT_NAME}${options.subject ? ` — ${options.subject}` : ''}`, () => {
    let result: ContractRunResult;
    let expectedIds: readonly string[];

    beforeAll(async () => {
      const executor = makeExecutor();
      // Same function the checker uses, so what is listed here and what actually
      // ran cannot diverge.
      expectedIds = expectedFulfillmentExecutorContractCaseIds(executor);
      result = await checkFulfillmentExecutorContract(executor, options.subject);
    });

    it('should run exactly the cases applicable to this subject', () => {
      expect(result.cases.map((c) => c.id).sort()).toEqual([...expectedIds].sort());
    });

    it('should record at least one comparison in every case it ran', () => {
      expect(result.cases.filter((c) => c.checks === 0).map((c) => c.id)).toEqual([]);
    });

    for (const id of [
      ...FULFILLMENT_EXECUTOR_CONTRACT_CASE_IDS,
      ...FULFILLMENT_STATUS_SOURCE_CONTRACT_CASE_IDS,
    ]) {
      it(`should satisfy "${id}" (or not be answerable for it)`, () => {
        const observed = result.cases.find((c) => c.id === id);
        if (!observed) {
          // Absent means not applicable — and that is not taken on trust: the
          // first `it` above asserts the absent set is exactly what the narrowing
          // predicts, so an absence can only mean the subject lacks the
          // sub-capability.
          expect(expectedIds).not.toContain(id);
          return;
        }
        expect({ id, failures: observed.failures }).toEqual({ id, failures: [] });
      });
    }
  });
}
