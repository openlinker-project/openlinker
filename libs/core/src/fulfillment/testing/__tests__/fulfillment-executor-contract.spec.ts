/**
 * The executor contract suite, run against conforming executors and against one
 * deliberate breakage per case (#2404, `W3a-15`)
 *
 * The second half is the load-bearing one — AC-2, "a deliberately non-conforming
 * fake adapter fails the kit". It is an ordinary unit test only because the rules
 * live in a PURE checker.
 *
 * The third half is specific to this port: `FulfillmentStatusSource` is OPTIONAL,
 * and the obvious handling of an optional capability is a skip — which is the
 * exact defect #2404 exists to prevent. Applicability is asserted in BOTH
 * directions instead, so an absent case can only mean the subject lacks the
 * sub-capability and can never mean a rule quietly stopped running.
 *
 * @module libs/core/src/fulfillment/testing/__tests__
 */
import type { FulfillmentExecutorPort } from '../../domain/ports/fulfillment-executor.port';
import { ContractSubjectMissingError } from '../contract-result.types';
import {
  FULFILLMENT_EXECUTOR_CONTRACT_CASE_IDS,
  FULFILLMENT_STATUS_SOURCE_CONTRACT_CASE_IDS,
  checkFulfillmentExecutorContract,
  expectedFulfillmentExecutorContractCaseIds,
  runFulfillmentExecutorContract,
} from '../fulfillment-executor-contract.suite';
import {
  ConformingExecutor,
  ConformingRejectingExecutor,
  ConformingStatusSourceExecutor,
  NON_CONFORMING_EXECUTORS,
} from './executors.fixtures';

describe('FulfillmentExecutorPort contract — conforming executors', () => {
  it.each([
    ['accepting', () => new ConformingExecutor()],
    ['rejecting', () => new ConformingRejectingExecutor()],
    ['status-source', () => new ConformingStatusSourceExecutor()],
  ])('should pass every applicable case for a %s executor', async (_label, make) => {
    const result = await checkFulfillmentExecutorContract(make());
    const failing = result.cases
      .filter((c) => c.failures.length > 0)
      .map((c) => ({ id: c.id, failures: c.failures }));
    expect(failing).toEqual([]);
  });

  it('should record a positive check count in every case it ran', async () => {
    const result = await checkFulfillmentExecutorContract(new ConformingStatusSourceExecutor());
    expect(result.cases.filter((c) => c.checks === 0).map((c) => c.id)).toEqual([]);
  });
});

describe('FulfillmentExecutorPort contract — optional sub-capability applicability', () => {
  it('should run ONLY the base cases for an executor that is not a status source', async () => {
    const result = await checkFulfillmentExecutorContract(new ConformingExecutor());
    expect(result.cases.map((c) => c.id).sort()).toEqual(
      [...FULFILLMENT_EXECUTOR_CONTRACT_CASE_IDS].sort(),
    );
  });

  it('should not report a status case as passing when the subject cannot answer it', async () => {
    // The direction that matters. A skipped-but-listed case is a green reading
    // over an unasked question; here the status ids must be ABSENT, and the
    // previous test pins that the absence is exactly the status set.
    const result = await checkFulfillmentExecutorContract(new ConformingExecutor());
    const reported = result.cases.map((c) => c.id);
    for (const id of FULFILLMENT_STATUS_SOURCE_CONTRACT_CASE_IDS) {
      expect(reported).not.toContain(id);
    }
  });

  it('should run base AND status cases for a status-source executor', async () => {
    const result = await checkFulfillmentExecutorContract(new ConformingStatusSourceExecutor());
    expect(result.cases.map((c) => c.id).sort()).toEqual(
      [
        ...FULFILLMENT_EXECUTOR_CONTRACT_CASE_IDS,
        ...FULFILLMENT_STATUS_SOURCE_CONTRACT_CASE_IDS,
      ].sort(),
    );
  });

  it('should decide applicability through the one function the wrapper also uses', async () => {
    // Reported === enforced structurally (#2229). If these two ever diverge the
    // wrapper could list a case the checker never ran.
    for (const make of [
      () => new ConformingExecutor(),
      () => new ConformingStatusSourceExecutor(),
    ]) {
      const subject = make();
      const result = await checkFulfillmentExecutorContract(subject);
      expect(result.cases.map((c) => c.id).sort()).toEqual(
        [...expectedFulfillmentExecutorContractCaseIds(subject)].sort(),
      );
    }
  });
});

describe('FulfillmentExecutorPort contract — vacuity guards', () => {
  it('should throw, not skip, when the factory produced no executor', async () => {
    await expect(
      checkFulfillmentExecutorContract(undefined as unknown as FulfillmentExecutorPort),
    ).rejects.toBeInstanceOf(ContractSubjectMissingError);
  });

  it('should throw when the subject implements only half the port', async () => {
    await expect(
      checkFulfillmentExecutorContract({
        requestFulfillment: () => Promise.resolve(undefined),
      } as unknown as FulfillmentExecutorPort),
    ).rejects.toBeInstanceOf(ContractSubjectMissingError);
  });

  it('should report a throwing case as a failure rather than swallowing it', async () => {
    const exploding = {
      requestFulfillment: () => {
        throw new Error('boom');
      },
      requestCancellation: () => {
        throw new Error('boom');
      },
    } as unknown as FulfillmentExecutorPort;

    const result = await checkFulfillmentExecutorContract(exploding);
    expect(result.cases.filter((c) => c.failures.length > 0).length).toBe(result.cases.length);
  });
});

describe('FulfillmentExecutorPort contract — non-conforming executors', () => {
  for (const caseId of [
    ...FULFILLMENT_EXECUTOR_CONTRACT_CASE_IDS,
    ...FULFILLMENT_STATUS_SOURCE_CONTRACT_CASE_IDS,
  ]) {
    it(`should fail exactly "${caseId}" (plus declared collateral) for its fixture`, async () => {
      const fixture = NON_CONFORMING_EXECUTORS[caseId];
      const result = await checkFulfillmentExecutorContract(fixture.make());

      const failing = result.cases
        .filter((c) => c.failures.length > 0)
        .map((c) => c.id)
        .sort();
      expect(failing).toEqual([caseId, ...fixture.expectedCollateral].sort());
    });
  }
});

// The jest wrapper, exercised against both applicability shapes — this is also
// the usage example an implementer copies.
runFulfillmentExecutorContract(() => new ConformingExecutor(), { subject: 'ConformingExecutor' });
runFulfillmentExecutorContract(() => new ConformingStatusSourceExecutor(), {
  subject: 'ConformingStatusSourceExecutor',
});
