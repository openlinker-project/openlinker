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
  // Normalised in exactly this one place (#3159 review, SUGGESTION — the
  // `inventory_locations.code` rule): `sourceCurrency` is normalised by the
  // PrestaShop source form's `<select>`, but `destinationCurrency` can also
  // arrive from `readConnectionCurrency`, which reads `config.currency`
  // VERBATIM — including a value the operator typed by hand through the raw
  // JSON editor, curl, or MCP, none of which normalise. Comparing raw would
  // report `currency-mismatch` for 'pln' vs 'PLN', which fails safe (it
  // blocks) but reads as a bug in OpenLinker rather than an operator typo.
  if (normalizeCurrencyCode(destinationCurrency) !== normalizeCurrencyCode(sourceCurrency)) {
    return 'currency-mismatch';
  }
  return null;
}

function normalizeCurrencyCode(currency: string): string {
  return currency.trim().toUpperCase();
}

/**
 * Reads `Connection.config.currency` — a loosely-typed key on
 * `ConnectionConfig`'s index signature. Returns `null` for anything but a
 * non-empty string, which the caller treats as "unknown" (see
 * `resolvePriceChangeBlockReason`).
 *
 * **This is now the FALLBACK source, not the primary one (#3203).**
 * `config.currency` is written by exactly one surface in the whole tree —
 * the PrestaShop (source/master) setup form
 * (`apps/web/src/features/connections/components/prestashop-setup.schema.ts`)
 * — and read there by exactly one other consumer, which stamps the SOURCE
 * product's currency (`PrestashopAdapterFactory`). No destination form
 * (Allegro, Erli, WooCommerce, or a generic connection editor) writes it,
 * and it is not even a declared field on `ConnectionConfig` — it lands on
 * the index signature. So this function alone still reads `null` on the
 * common PrestaShop → Allegro/Erli/WooCommerce topology.
 *
 * `readConnectionCurrency`'s callers (`PriceChangeDetectionService`,
 * `PriceChangesService`) read THIS function FIRST and fall back to
 * `IDestinationCurrencyResolutionService` — an adapter-declared value
 * (`OfferCurrencyDeclarer` / `ShopCurrencyDeclarer`, the `DescriptionFormat`
 * / `ResolveConcurrencyCeiling` precedent) — only when this key is unset
 * (#3159 review, BLOCKING). **The operator's own statement wins over the
 * adapter's**, never the reverse: Allegro's declared `'PLN'` is a fixed
 * assumption about a PL-first storefront, and a seller on `allegro-cz` /
 * `allegro-sk` / `allegro-hu` settles in a different currency with no
 * adapter-side way to say so — if the declared value won, that operator
 * would have no remedy left in the product for a wrong guess on a value
 * that gates an AUTOMATIC price publish with no human in the loop. #2229
 * states the same rule for a different knob: "The operator's
 * `config.rateLimit.maxConcurrent` clamps the ceiling DOWNWARD only… a
 * safety valve on the operator's own quota" — operator narrows/overrides
 * adapter, never the other way round.
 *
 * Allegro and Erli both declare their fixed settlement currency (`'PLN'`,
 * matching the PL-first / PLN-only assumptions already baked into both
 * adapters), so the automatic-apply bypass is reachable on those two
 * destinations without any operator configuration WHEN this key is unset;
 * a destination that declares nothing (WooCommerce today) still relies
 * entirely on this function, and an operator may set `config.currency` by
 * hand on ANY connection — source or destination — both to unblock an
 * undeclared destination AND to correct a wrong adapter assumption. This
 * function's own behaviour is unchanged: it still never guesses, and
 * `null` still means "unknown", not "known to match" (ADR-061's
 * `provenance: 'unknown'` / #2599's three-state `buyerHasTaxId` widening
 * rule, restated once more rather than reinvented).
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
