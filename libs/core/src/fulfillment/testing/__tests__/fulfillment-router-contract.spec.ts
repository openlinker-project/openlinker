/**
 * The contract suite, run against a conforming router and against one
 * deliberate breakage per case (#2404, `W3a-15`)
 *
 * The second half is the load-bearing one — AC-2, "a deliberately
 * non-conforming fake adapter fails the kit". It is an ordinary unit test only
 * because the rules live in a PURE checker; against the jest-coupled shape the
 * two shipped suites use (`runKsefHttpClientContract`,
 * `runSubiektBridgeContractTests`) it would need a nested runner or global
 * spying.
 *
 * Each fixture must fail EXACTLY its own case plus the collateral it declares.
 * "At least the target failed" would pass a fixture that broke everything, which
 * proves nothing about the rule under test.
 *
 * @module libs/core/src/fulfillment/testing/__tests__
 */
import {
  FULFILLMENT_ROUTER_CONTRACT_CASE_IDS,
  checkFulfillmentRouterContract,
  runFulfillmentRouterContract,
} from '../fulfillment-router-contract.suite';
import { ConformingRouter, NON_CONFORMING_ROUTERS } from './routers.fixtures';

describe('FulfillmentRouterPort contract — conforming router', () => {
  it('should pass every declared case', async () => {
    const result = await checkFulfillmentRouterContract(new ConformingRouter());
    const failing = result.cases
      .filter((c) => c.failures.length > 0)
      .map((c) => ({ id: c.id, failures: c.failures }));
    expect(failing).toEqual([]);
  });

  it('should run exactly the declared cases', async () => {
    const result = await checkFulfillmentRouterContract(new ConformingRouter());
    expect(result.cases.map((c) => c.id).sort()).toEqual(
      [...FULFILLMENT_ROUTER_CONTRACT_CASE_IDS].sort(),
    );
  });
});

describe('FulfillmentRouterPort contract — non-conforming routers', () => {
  for (const caseId of FULFILLMENT_ROUTER_CONTRACT_CASE_IDS) {
    it(`should fail exactly "${caseId}" (plus declared collateral) for its fixture`, async () => {
      const fixture = NON_CONFORMING_ROUTERS[caseId];
      const result = await checkFulfillmentRouterContract(fixture.make());

      const failing = result.cases.filter((c) => c.failures.length > 0).map((c) => c.id).sort();
      const expected = [caseId, ...fixture.expectedCollateral].sort();

      expect(failing).toEqual(expected);
    });
  }
});

// The jest wrapper, exercised against the conforming router — this is also the
// usage example an implementer copies.
runFulfillmentRouterContract(() => new ConformingRouter(), { subject: 'ConformingRouter' });
