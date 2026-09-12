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
 * `destinationCurrency === null` (unconfigured/unresolvable) is an UNKNOWN
 * currency, never treated as "known to match" (#3159 review) — the same
 * rule ADR-061's `provenance: 'unknown'` and #2599's three-state
 * `buyerHasTaxId` widening apply: an absent fact must never collapse into a
 * favourable one. `'destination-currency-unknown'` blocks the AUTOMATIC
 * bypass (ADR-072 decision 3) specifically, while the episode itself still
 * opens for manual review — an operator can still decide by hand even when
 * OL cannot verify the currency on its own.
 *
 * See `readConnectionCurrency`'s docblock for why this reason is expected to
 * fire on most real installs today.
 */
export function resolvePriceChangeBlockReason(
  sourceCurrency: string,
  destinationCurrency: string | null
): PriceChangeBlockReason | null {
  if (destinationCurrency === null) {
    return 'destination-currency-unknown';
  }
  if (destinationCurrency !== sourceCurrency) {
    return 'currency-mismatch';
  }
  return null;
}

/**
 * Reads `Connection.config.currency` — a loosely-typed key on
 * `ConnectionConfig`'s index signature. Returns `null` for anything but a
 * non-empty string, which the caller treats as "unknown" (see
 * `resolvePriceChangeBlockReason`).
 *
 * **This guard is inert on the repo's default topology today (#3159
 * review).** `config.currency` is written by exactly one surface in the
 * whole tree — the PrestaShop (source/master) setup form
 * (`apps/web/src/features/connections/components/prestashop-setup.schema.ts`)
 * — and read by exactly one consumer, which stamps the SOURCE product's
 * currency (`PrestashopAdapterFactory`). No destination form (Allegro,
 * Erli, WooCommerce, or a generic connection editor) ever writes it, and it
 * is not even a declared field on `ConnectionConfig` — it lands on the
 * index signature. So on the common PrestaShop → Allegro path this reads
 * `null`, resolving to `'destination-currency-unknown'` rather than a
 * verified match. Resolving a destination's REAL currency (its marketplace
 * account, or an adapter-declared value) is a larger follow-up this
 * function does not attempt — tracked as
 * https://github.com/openlinker-project/openlinker/issues/3203, so this
 * docblock doesn't read as an unowned gap three PRs later; until it ships,
 * every destination effectively behaves as unverified-currency, which is
 * the conservative posture the caller's block reason is built to express
 * rather than to hide.
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
