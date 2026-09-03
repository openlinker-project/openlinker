/**
 * Currency — test-only exports (#2800 review, finding 2)
 *
 * Consumed from `*.spec.ts` / `*.int-spec.ts` only, never from runtime code -
 * the convention the `identifier-mapping`, `integrations`, `events`,
 * `inventory`, `returns` and `fulfillment` testing sub-barrels already
 * follow.
 *
 * `libs/core/src/currency` is a leaf context (see `docs/architecture-
 * overview.md § 18 Currency`) - nothing under it imports a sibling
 * `@openlinker/core/*` context. This subpath does not change that: it is
 * consumed by `@openlinker/integrations-fx`'s adapter specs, which already
 * depend on `@openlinker/core/currency` for the port and types this suite
 * exercises.
 *
 * @module libs/core/src/currency/testing
 */
export {
  ContractSubjectMissingError,
  EmptyContractSuiteError,
} from './contract-result.types';
export type {
  ContractCaseRecorder,
  ContractCaseResult,
  ContractRunResult,
} from './contract-result.types';

export {
  PUBLICATION_DAY_CONTRACT_CASE_IDS,
  PUBLICATION_DAY_CONTRACT_DATES,
  PUBLICATION_DAY_CONTRACT_REAL_CALENDAR_FIXTURES,
  checkPublicationDayContract,
  providerDeclaresPublicationDayResolution,
  runPublicationDayContract,
} from './publication-day-contract.suite';
export type {
  PublicationDayContractCaseId,
  PublicationDayContractFixtures,
} from './publication-day-contract.suite';
