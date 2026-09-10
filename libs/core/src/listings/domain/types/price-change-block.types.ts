/**
 * Price Change Block Reason (#3143, ADR-072 decision 4)
 *
 * Follows the `SalesDocumentBlockOutcome` discipline exactly
 * (`libs/core/src/sales-documents`): a PURE function decides the block
 * reason, the owning service (`PriceChangeDetectionService`) persists it,
 * it is RE-DECIDED on every detection pass (so a later currency fix clears
 * it automatically on the next master price change), and it is never
 * inferred client-side — the API (#3145) exposes `blockReason` as a field.
 *
 * @module libs/core/src/listings/domain/types
 */
import type { PriceChangeBlockReason } from './price-change-episode.types';

/**
 * ADR-072 decision 4: same-currency only in v1. A source/destination
 * mismatch is never silently converted — it blocks, naming why.
 *
 * `destinationCurrency === null` (unconfigured) is treated as "no mismatch":
 * a destination with no configured currency has never expressed an opinion
 * to disagree with, and refusing every such connection would regress every
 * install that predates this feature.
 */
export function resolvePriceChangeBlockReason(
  sourceCurrency: string,
  destinationCurrency: string | null
): PriceChangeBlockReason | null {
  if (destinationCurrency !== null && destinationCurrency !== sourceCurrency) {
    return 'currency-mismatch';
  }
  return null;
}

/**
 * Reads `Connection.config.currency` — a loosely-typed key on
 * `ConnectionConfig`'s index signature (set today by, e.g., the PrestaShop
 * setup form). Returns `null` for anything but a non-empty string, which the
 * caller treats as "unconfigured" (see `resolvePriceChangeBlockReason`).
 */
export function readConnectionCurrency(
  config: Record<string, unknown> | null | undefined
): string | null {
  if (!config) {
    return null;
  }
  const raw = config['currency'];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}
