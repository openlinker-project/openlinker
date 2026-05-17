/**
 * Offer Smart Classification Reader Capability
 *
 * Optional sub-capability of `OfferManagerPort` — adapters that can fetch
 * a post-create classification report for an offer declare
 * `implements OfferManagerPort, OfferSmartClassificationReader`.
 *
 * Today only the Allegro adapter implements this (reading `/sale/offers/{id}/smart`).
 * The offer-creation flow (#737) uses it twice per offer:
 *   1. At create-success in `OfferCreationExecutionService` (active-on-create branch).
 *   2. On the `validating → active` transition in `OfferStatusPollService`.
 *
 * See `offer-lister.capability.ts` for the shared naming convention.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { OfferManagerPort } from '../offer-manager.port';
import type { SmartClassificationReport } from '../../types/smart-classification.types';

export interface OfferSmartClassificationReader {
  /**
   * Fetch the marketplace's classification report for an offer.
   *
   * - Returns `null` only for **404** — the offer isn't yet classified
   *   (Allegro takes a few seconds-to-minutes post-create to compute).
   *   Persistable; callers do NOT retry on null in this PR's scope.
   * - Throws on any other error: 4xx (non-404), 5xx, network. Callers
   *   are expected to wrap in try/catch and degrade gracefully — Smart
   *   readback failure MUST NOT fail the offer-creation job (AC-7).
   *
   * Call sites narrow via `isOfferSmartClassificationReader(adapter)`.
   */
  getOfferSmartClassification(externalOfferId: string): Promise<SmartClassificationReport | null>;
}

export function isOfferSmartClassificationReader(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & OfferSmartClassificationReader {
  return (
    typeof (adapter as Partial<OfferSmartClassificationReader>).getOfferSmartClassification ===
    'function'
  );
}
