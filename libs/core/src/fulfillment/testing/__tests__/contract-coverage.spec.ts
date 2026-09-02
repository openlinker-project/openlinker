/**
 * The PRIMARY anti-vacuity guard (#2404, `W3a-15`)
 *
 * A contract suite is exactly the machinery that can look thorough and assert
 * nothing. The `checks` counter on `ContractCaseResult` is self-reported, so it
 * only catches a case that never RAN — not one that ran and compared nothing.
 * What actually holds the suite honest is that every declared case has a
 * deliberate breakage proving it can fail.
 *
 * This spec asserts that DECLARED equals COVERED, failing on either side. Without
 * it, a case could be added to `FULFILLMENT_ROUTER_CONTRACT_CASE_IDS` with no
 * fixture, and the suite would stay green while covering nothing — "declared" and
 * "covered" collapsing into one reading, which is #2673's defect exactly.
 *
 * @module libs/core/src/fulfillment/testing/__tests__
 */
import { FULFILLMENT_ROUTER_CONTRACT_CASE_IDS } from '../fulfillment-router-contract.suite';
import { NON_CONFORMING_ROUTERS } from './routers.fixtures';

describe('FulfillmentRouterPort contract — coverage', () => {
  it('should declare at least one contract case', () => {
    // `libs/core`'s jest config could be pointed at a moved file; a suite that
    // declares nothing must never read as a short green run.
    expect(FULFILLMENT_ROUTER_CONTRACT_CASE_IDS.length).toBeGreaterThan(0);
  });

  it('should have a non-conforming fixture for every declared case, and no orphan fixture', () => {
    const declared = [...FULFILLMENT_ROUTER_CONTRACT_CASE_IDS].sort();
    const covered = Object.keys(NON_CONFORMING_ROUTERS).sort();
    expect(covered).toEqual(declared);
  });
});
