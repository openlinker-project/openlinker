/**
 * Price Change Apply Service Interface
 *
 * @module libs/core/src/listings/application/services
 */
import type {
  PriceChangeApplyInput,
  PriceChangeApplyResult,
} from '../../domain/types/price-change-apply.types';

export interface IPriceChangeApplyService {
  /**
   * Apply one price change — whether it arrived via an accepted/edited
   * review-queue episode or directly from an `automatic`-mode detection
   * (#3143) — to whichever destination capability the connection actually
   * has enabled (marketplace `OfferManager` field update, or a shop
   * `ProductPublisher` re-publish).
   *
   * Resolves normally with `{outcome: 'business_failure'}` for a
   * deterministic, non-retryable condition (ADR-007) and throws for a
   * transient one. Advances the caller's bulk-batch progress (#3145/#3148)
   * itself when `input.batchId` is present, so a worker handler never has to
   * remember to do so on every exit path.
   */
  applyPriceChange(input: PriceChangeApplyInput): Promise<PriceChangeApplyResult>;
}
