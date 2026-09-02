/**
 * Fulfillment — test-only exports (#2404)
 *
 * Consumed from `*.spec.ts` / `*.int-spec.ts` only, never from runtime code —
 * the convention the `identifier-mapping`, `integrations`, `events`, `inventory`
 * and `returns` testing sub-barrels already follow.
 *
 * **This one carries an extra obligation those do not.** A port-contract suite
 * names ambient Jest globals (`describe` / `it` / `expect`), which exist only
 * under a test runner. So it must stay off the production `@openlinker/core/fulfillment`
 * barrel: a runtime `require()` reaching this code dies with `describe is not
 * defined`, at the far end of a stack trace that explains nothing.
 * `scripts/check-contract-suite-not-in-production.mjs` asserts that separation
 * rather than leaving it to reviewer vigilance.
 *
 * @module libs/core/src/fulfillment/testing
 */
export {
  FULFILLMENT_ROUTER_CONTRACT_CASE_IDS,
  FULFILLMENT_ROUTER_CONTRACT_INPUT,
  checkFulfillmentRouterContract,
  runFulfillmentRouterContract,
} from './fulfillment-router-contract.suite';
export type { FulfillmentRouterContractCaseId } from './fulfillment-router-contract.suite';

export {
  FULFILLMENT_EXECUTOR_CONTRACT_CASE_IDS,
  FULFILLMENT_STATUS_SOURCE_CONTRACT_CASE_IDS,
  FULFILLMENT_EXECUTOR_CONTRACT_REQUEST,
  FULFILLMENT_EXECUTOR_CONTRACT_WORK,
  checkFulfillmentExecutorContract,
  expectedFulfillmentExecutorContractCaseIds,
  runFulfillmentExecutorContract,
} from './fulfillment-executor-contract.suite';
export type { FulfillmentExecutorContractCaseId } from './fulfillment-executor-contract.suite';

export {
  ContractSubjectMissingError,
  EmptyContractSuiteError,
} from './contract-result.types';
export type {
  ContractCaseRecorder,
  ContractCaseResult,
  ContractRunResult,
} from './contract-result.types';
