/**
 * `OlFulfillmentExecutorAdapter` — contract conformance + the decisions the contract cannot see
 *
 * The OL-OMS executor is the FIRST real subject of #2404's `FulfillmentExecutorPort` contract kit, so
 * this file runs that suite verbatim and then pins the three choices the suite is structurally unable
 * to observe: that the adapter declines `FulfillmentStatusSource`, that its acceptance instant is
 * `null`, and that it assigns no external reference.
 *
 * @module libs/oms/src/execution/__tests__
 */
import { isFulfillmentStatusSource } from '@openlinker/core/fulfillment';
import type { FulfillmentRequest } from '@openlinker/core/fulfillment';
import {
  FULFILLMENT_EXECUTOR_CONTRACT_CASE_IDS,
  FULFILLMENT_EXECUTOR_CONTRACT_REQUEST,
  FULFILLMENT_EXECUTOR_CONTRACT_WORK,
  FULFILLMENT_STATUS_SOURCE_CONTRACT_CASE_IDS,
  expectedFulfillmentExecutorContractCaseIds,
  runFulfillmentExecutorContract,
} from '@openlinker/core/fulfillment/testing';

import { OlFulfillmentExecutorAdapter } from '../ol-fulfillment-executor.adapter';

runFulfillmentExecutorContract(() => new OlFulfillmentExecutorAdapter(), {
  subject: 'OlFulfillmentExecutorAdapter',
});

describe('OlFulfillmentExecutorAdapter', () => {
  const withKey = (idempotencyKey: string): FulfillmentRequest => ({
    ...FULFILLMENT_EXECUTOR_CONTRACT_REQUEST,
    idempotencyKey,
  });

  describe('FulfillmentStatusSource', () => {
    /**
     * Asserted POSITIVELY rather than inferred from the suite's silence.
     *
     * The contract kit reports a non-applicable case by ABSENCE, so "the status cases did not fail"
     * and "the status cases never ran" look identical from the outside. Declining the sub-capability
     * is a deliberate design decision (a poll would read core's own counters and report them back to
     * core as observed progress), so it is stated as its own assertion.
     */
    it('should not be narrowed as a status source, because a poll would read OLs own counters back to OL', () => {
      expect(isFulfillmentStatusSource(new OlFulfillmentExecutorAdapter())).toBe(false);
    });

    it('should be answerable for exactly the base contract cases and none of the status cases', () => {
      const ids = expectedFulfillmentExecutorContractCaseIds(new OlFulfillmentExecutorAdapter());

      expect([...ids].sort()).toEqual([...FULFILLMENT_EXECUTOR_CONTRACT_CASE_IDS].sort());
      for (const statusId of FULFILLMENT_STATUS_SOURCE_CONTRACT_CASE_IDS) {
        expect(ids).not.toContain(statusId);
      }
    });
  });

  describe('requestFulfillment', () => {
    it('should accept the work unconditionally, assigning no external reference and inventing no instant', async () => {
      const result = await new OlFulfillmentExecutorAdapter().requestFulfillment(
        FULFILLMENT_EXECUTOR_CONTRACT_REQUEST
      );

      // `acceptedAt: null` is FORCED, not chosen: a fresh Date per call breaks the port's replay
      // rule. `externalWorkId: null` is chosen — the work row IS the holder's record, and echoing
      // `workId` back would put core's own key in a column meaning "foreign reference".
      //
      // **This assertion is the DETERMINISTIC guard, and #2404's contract kit is not.** Measured
      // while red-first-checking this adapter: with `acceptedAt: new Date()`, the kit's
      // `request/replays-original-outcome` case stays GREEN, because it compares the two answers
      // with `JSON.stringify` and two in-process calls land in the same millisecond, rendering an
      // identical ISO string. Forcing the two instants a second apart makes that case fail, which
      // is what proves the mechanism rather than assuming it. So the kit cannot catch the single
      // most likely real violation of the rule, and this line is what does. Reported against
      // #2404 (issuecomment-5482760868), with the three candidate fixes; do not delete this line
      // as redundant with the suite until that case stops depending on wall-clock luck.
      expect(result).toEqual({ status: 'accepted', externalWorkId: null, acceptedAt: null });
    });

    /**
     * OVERLAPPING, never sequential (the #2399 `[1, 2]` precedent).
     *
     * **Stated plainly: against today's stateless adapter this cannot fail.** Replay-stability is
     * true by construction, so as evidence about THIS build the assertion is vacuous. It is shipped
     * to constrain a FUTURE implementation that grows state — a per-instance cache keyed on the last
     * request would pass a sequential A,A / B,B test and fail this one. The honest red-first check for
     * the current build is different and is recorded in the PR: temporarily return `new Date()` for
     * `acceptedAt` and watch the kit's `request/replays-original-outcome` case go red.
     */
    it('should replay each key\'s original outcome when two keys are interleaved', async () => {
      const executor = new OlFulfillmentExecutorAdapter();
      const a = withKey('work:ol_fulfillmentwork_contract_fixture:1');
      const b = withKey('work:ol_fulfillmentwork_contract_fixture:2');

      const firstA = await executor.requestFulfillment(a);
      const firstB = await executor.requestFulfillment(b);
      const secondA = await executor.requestFulfillment(a);
      const secondB = await executor.requestFulfillment(b);

      expect(secondA).toEqual(firstA);
      expect(secondB).toEqual(firstB);
    });
  });

  describe('requestCancellation', () => {
    it('should comply, because the work is OpenLinkers own and no third party is committed', async () => {
      const result = await new OlFulfillmentExecutorAdapter().requestCancellation({
        work: FULFILLMENT_EXECUTOR_CONTRACT_WORK,
        reason: 'operator_forced',
        idempotencyKey: 'work:ol_fulfillmentwork_contract_fixture:1:cancel',
      });

      expect(result).toEqual({ status: 'accepted', externalWorkId: null, acceptedAt: null });
    });

    it('should answer a dispatch and a cancellation from independent constants', async () => {
      // Structurally identical today, deliberately separate in source. This asserts they are not
      // literally the same object, so a future change to one cannot silently change the other.
      const executor = new OlFulfillmentExecutorAdapter();
      const dispatch = await executor.requestFulfillment(FULFILLMENT_EXECUTOR_CONTRACT_REQUEST);
      const cancellation = await executor.requestCancellation({
        work: FULFILLMENT_EXECUTOR_CONTRACT_WORK,
        reason: 'operator_forced',
        idempotencyKey: 'work:ol_fulfillmentwork_contract_fixture:1:cancel',
      });

      expect(dispatch).not.toBe(cancellation);
    });
  });
});
