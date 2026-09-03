/**
 * The PRIMARY anti-vacuity guard for the executor suite (#2404, `W3a-15`)
 *
 * The `checks` counter on `ContractCaseResult` is self-reported, so it only
 * catches a case that never RAN — not one that ran and compared nothing. What
 * actually holds the suite honest is that every declared case has a deliberate
 * breakage proving it can fail.
 *
 * This spec asserts DECLARED equals COVERED, failing on either side. Without it a
 * case could be added to either table with no fixture, and the suite would stay
 * green while covering nothing — "declared" and "covered" collapsing into one
 * reading, which is #2673's defect exactly.
 *
 * @module libs/core/src/fulfillment/testing/__tests__
 */
import {
  FULFILLMENT_EXECUTOR_CONTRACT_CASE_IDS,
  FULFILLMENT_STATUS_SOURCE_CONTRACT_CASE_IDS,
} from '../fulfillment-executor-contract.suite';
import { NON_CONFORMING_EXECUTORS } from './executors.fixtures';

describe('FulfillmentExecutorPort contract — coverage', () => {
  it('should declare at least one case in each table', () => {
    // A suite that declares nothing must never read as a short green run.
    expect(FULFILLMENT_EXECUTOR_CONTRACT_CASE_IDS.length).toBeGreaterThan(0);
    expect(FULFILLMENT_STATUS_SOURCE_CONTRACT_CASE_IDS.length).toBeGreaterThan(0);
  });

  it('should have a non-conforming fixture for every declared case, and no orphan fixture', () => {
    const declared = [
      ...FULFILLMENT_EXECUTOR_CONTRACT_CASE_IDS,
      ...FULFILLMENT_STATUS_SOURCE_CONTRACT_CASE_IDS,
    ].sort();
    const covered = Object.keys(NON_CONFORMING_EXECUTORS).sort();
    expect(covered).toEqual(declared);
  });

  it('should declare no case id twice across the two tables', () => {
    const all = [
      ...FULFILLMENT_EXECUTOR_CONTRACT_CASE_IDS,
      ...FULFILLMENT_STATUS_SOURCE_CONTRACT_CASE_IDS,
    ];
    // A duplicate would silently make one table's entry unreachable while the
    // coverage equality above still passed on the deduplicated key set.
    expect(new Set(all).size).toBe(all.length);
  });
});
