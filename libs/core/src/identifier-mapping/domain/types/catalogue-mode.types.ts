/**
 * Catalogue Mode
 *
 * Per-connection switch for an order SOURCE (a marketplace) that says whether its
 * order lines are expected to resolve to products in an OpenLinker catalogue
 * (#4280). `'linked'` is the historical behaviour: a line that cannot be mapped
 * parks the order in `awaiting_mapping` until a ProductMaster sweep creates the
 * mapping. `'none'` is for an install that has only a marketplace connection and
 * no ProductMaster at all: an unmapped line is accepted as an "unmatched" line
 * (see `unmatched-product-id.types.ts`) so the order can reach `ready`, be
 * tracked and be shipped without a catalogue.
 *
 * The key is an explicit per-connection setting rather than "no active
 * ProductMaster exists" on purpose: that would make the outcome of an order depend
 * on global mutable state, and a temporary disable of a master would turn today's
 * self-healing `awaiting_mapping` into permanent unmatched orders.
 *
 * Pure helpers (no I/O), mirroring the `readStockSafetyBuffer` config-coercion
 * precedent. Marketplace-neutral: nothing here names a platform.
 *
 * @module libs/core/src/identifier-mapping/domain/types
 */
import type { ConnectionConfig } from './connection.types';

/**
 * Config key holding the catalogue mode on `Connection.config`.
 */
export const CATALOGUE_MODE_CONFIG_KEY = 'catalogueMode';

export const CatalogueModeValues = ['linked', 'none'] as const;

export type CatalogueMode = (typeof CatalogueModeValues)[number];

/**
 * The behaviour of a connection that has never had the key set. Everything that
 * reads the key falls back to this, so an install that never opens the setting is
 * byte-identical to its pre-#4280 self.
 */
export const DEFAULT_CATALOGUE_MODE: CatalogueMode = 'linked';

function isCatalogueMode(value: unknown): value is CatalogueMode {
  return typeof value === 'string' && (CatalogueModeValues as readonly string[]).includes(value);
}

/**
 * Read the catalogue mode from a connection config.
 *
 * Coerces defensively and fails SAFE: a missing key, an explicit `null` (what the
 * connection form writes for a cleared value, #2016) or any unrecognised value
 * reads as `'linked'`, because the alternative - guessing `'none'` - would stop
 * parking unmapped orders on an install that never asked for that.
 */
export function readCatalogueMode(config: ConnectionConfig | null | undefined): CatalogueMode {
  if (!config) {
    return DEFAULT_CATALOGUE_MODE;
  }
  const raw = config[CATALOGUE_MODE_CONFIG_KEY];
  return isCatalogueMode(raw) ? raw : DEFAULT_CATALOGUE_MODE;
}

/**
 * Report whether `config.catalogueMode` is present but not a recognised value.
 *
 * A mistyped value (`"None"`, `true`, `1`) reads back as `'linked'`, i.e. it
 * silently fails to turn the mode on, so the service validator rejects it on write
 * and callers can warn on it. Absent and `null` are the intentional "default"
 * statement and are NOT invalid.
 */
export function isPresentButInvalidCatalogueMode(
  config: ConnectionConfig | null | undefined
): boolean {
  if (!config) {
    return false;
  }
  const raw = config[CATALOGUE_MODE_CONFIG_KEY];
  if (raw == null) {
    return false;
  }
  return !isCatalogueMode(raw);
}
