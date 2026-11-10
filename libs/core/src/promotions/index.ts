/**
 * Promotions public surface (#3935)
 *
 * Contracts safe to import from a sibling context: types, the pure planner and
 * evaluator, ports, service interfaces, tokens, errors and the module. Not
 * re-exported from the root barrel (the `automation` posture).
 *
 * @module libs/core/src/promotions
 */
export * from './promotions.tokens';
export { PromotionsModule } from './promotions.module';

export { Promotion } from './domain/entities/promotion.entity';
export * from './domain/types/promotion-benefit.types';
export * from './domain/types/promotion-condition.types';
export * from './domain/types/promotion-limits.types';
export * from './domain/types/promotion-facts.types';
export * from './domain/types/promotion-application.types';
export * from './domain/types/promotion-definition-hash.types';
export * from './domain/exceptions/promotion.errors';
export * from './domain/domain-services/evaluate-promotions';
export * from './domain/domain-services/plan-promotions';
export {
  BENEFIT_POLICIES,
  policyFor,
  type BenefitPolicy,
  type BenefitPolicyInput,
  type BenefitQuantityResult,
  type BenefitSupplyResult,
} from './domain/domain-services/benefit-policies/benefit-policy';
export type {
  PromotionPersistInput,
  PromotionRepositoryPort,
} from './domain/ports/promotion-repository.port';
export type { PromotionLedgerPort } from './domain/ports/promotion-ledger.port';
export type {
  AppendPromotionApplication,
  PromotionApplicationLogPort,
} from './domain/ports/promotion-application-log.port';
export {
  PROMOTION_DRAFT_ID,
  type IPromotionService,
  type PromotionInput,
  type PromotionView,
} from './application/interfaces/promotion.service.interface';
export type {
  ApplyPromotionsInput,
  ApplyPromotionsResult,
  IPromotionApplicationService,
  PreviewPromotionsInput,
  PreviewPromotionsResult,
  PromotionLineGrant,
  PromotionStockReader,
} from './application/interfaces/promotion-application.service.interface';
