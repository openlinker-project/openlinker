/**
 * Mapping Option Types
 *
 * Neutral `{ value, label }` shape used by `DestinationOptionsReader` and
 * `SourceOptionsReader` capabilities (#472) to populate the carrier-mapping
 * UI dropdowns. The `value` field is the stable identifier persisted by
 * mapping config (PrestaShop `id_reference`, Allegro `methodId`); `label` is
 * the human-readable string for FE rendering.
 *
 * Mirrors the `MappingOptionResponseDto` shape so the API can return the
 * adapter result directly without remapping.
 *
 * @module libs/core/src/orders/domain/types
 */

export interface MappingOption {
  /** Stable identifier persisted by mapping configuration. */
  value: string;
  /** Human-readable label for FE dropdowns. */
  label: string;
}
