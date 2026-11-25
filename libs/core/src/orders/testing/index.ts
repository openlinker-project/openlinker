/**
 * Orders - test-only exports (#3482)
 *
 * Consumed from `*.spec.ts` / `*.int-spec.ts` only, never from runtime code. Kept
 * off the production barrel so a fixture cannot be imported into a controller by
 * autocomplete - the convention the other `/testing` sub-barrels follow.
 *
 * @module libs/core/src/orders/testing
 */
export { ORDER_HEALTH_FIXTURES } from './order-health.fixtures';
export type { OrderHealthFixture, OrderHealthFixtureBucket } from './order-health.fixtures';

// Jest-coupled (describe/it/expect). Reachable only from this sub-barrel; see
// scripts/check-contract-suite-not-in-production.mjs.
export {
  ORDER_SOURCE_START_CONTRACT_CASE_IDS,
  checkOrderSourceStartContract,
  expectedOrderSourceStartContractCaseIds,
  runOrderSourceStartContract,
} from './order-source-start-contract.suite';
export type {
  OrderSourceStartContractCaseId,
  OrderSourceStartDeclaration,
  OrderSourceStartScenario,
  OrderSourceStartSubject,
} from './order-source-start-contract.suite';
export {
  ContractSubjectMissingError,
  EmptyContractSuiteError,
} from '../../fulfillment/testing/contract-result.types';
export type {
  ContractCaseRecorder,
  ContractCaseResult,
  ContractRunResult,
} from '../../fulfillment/testing/contract-result.types';
