/**
 * The suite must FAIL rather than skip when it cannot say anything (#2404)
 *
 * Two states are structural faults, not contract results: being handed no
 * subject, and declaring no cases. Both are thrown. A suite that quietly passes
 * because it found nothing to test is the defect this issue exists to prevent,
 * and it is the shape #2673 shipped for months.
 *
 * @module libs/core/src/fulfillment/testing/__tests__
 */
import type { FulfillmentRouterPort } from '../../domain/ports/fulfillment-router.port';
import {
  ContractSubjectMissingError,
  EmptyContractSuiteError,
} from '../contract-result.types';
import { checkFulfillmentRouterContract } from '../fulfillment-router-contract.suite';
import { ConformingRouter } from './routers.fixtures';

describe('FulfillmentRouterPort contract — vacuity guards', () => {
  it('should throw, not skip, when the factory produced no router', async () => {
    await expect(
      checkFulfillmentRouterContract(undefined as unknown as FulfillmentRouterPort),
    ).rejects.toBeInstanceOf(ContractSubjectMissingError);
  });

  it('should throw when the subject does not implement the port', async () => {
    await expect(
      checkFulfillmentRouterContract({ route: () => undefined } as unknown as FulfillmentRouterPort),
    ).rejects.toBeInstanceOf(ContractSubjectMissingError);
  });

  it('should expose an error type for an empty case table', () => {
    // The runner throws this when its case table is empty. The table is a module
    // constant, so the throw cannot be reached from outside without gutting the
    // suite — which is the point: this asserts the refusal EXISTS and carries the
    // contract name, so a future refactor that empties the table meets it.
    const error = new EmptyContractSuiteError('FulfillmentRouterPort contract');
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('asserts nothing and must fail');
  });

  it('should record a positive check count for every case on a conforming router', async () => {
    const result = await checkFulfillmentRouterContract(new ConformingRouter());
    for (const contractCase of result.cases) {
      expect({ id: contractCase.id, checks: contractCase.checks > 0 }).toEqual({
        id: contractCase.id,
        checks: true,
      });
    }
  });

  it('should report a throwing case as a failure rather than swallowing it', async () => {
    const exploding = {
      route: () => {
        throw new Error('boom');
      },
      evaluate: () => {
        throw new Error('boom');
      },
    } as unknown as FulfillmentRouterPort;

    const result = await checkFulfillmentRouterContract(exploding);
    const withFailures = result.cases.filter((c) => c.failures.length > 0);
    expect(withFailures.length).toBe(result.cases.length);
  });
});
