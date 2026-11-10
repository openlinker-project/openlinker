/**
 * Promotions DI tokens (#3935). Symbol tokens only, per the convention in
 * `docs/engineering-standards.md`.
 *
 * @module libs/core/src/promotions
 */
export const PROMOTION_REPOSITORY_TOKEN = Symbol('PromotionRepositoryPort');
export const PROMOTION_LEDGER_TOKEN = Symbol('PromotionLedgerPort');
export const PROMOTION_APPLICATION_LOG_TOKEN = Symbol('PromotionApplicationLogPort');
export const PROMOTION_SERVICE_TOKEN = Symbol('IPromotionService');
export const PROMOTION_APPLICATION_SERVICE_TOKEN = Symbol('IPromotionApplicationService');
