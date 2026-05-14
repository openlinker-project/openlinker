/**
 * Upload Images Via Allegro Types
 *
 * Public type surface for the `upload-images-via-allegro` orchestrator.
 * Kept in a dedicated `.types.ts` file per Engineering Standards
 * "Type Definitions in Separate Files".
 *
 * @module libs/integrations/allegro/src/infrastructure/util
 */
import type { CreateOfferValidationError } from '@openlinker/core/listings';

/**
 * Discriminated result of `uploadImagesViaAllegro`.
 *
 * The util never throws for image-related failures — failures surface as
 * a list of neutral `CreateOfferValidationError` so the calling adapter
 * can wrap them into the appropriate platform-specific exception
 * (`OfferCreateRejectedException` for Allegro).
 */
export type UploadImagesResult =
  | { ok: true; locations: string[] }
  | { ok: false; failures: CreateOfferValidationError[] };

/**
 * Options for `uploadImagesViaAllegro`.
 */
export interface UploadImagesViaAllegroOptions {
  /** Override fetch (tests). Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Per-URL download timeout. Default 30 000 ms. */
  downloadTimeoutMs?: number;
}
