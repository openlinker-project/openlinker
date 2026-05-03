/**
 * Mapping Option Types
 *
 * Neutral `{ value, label, kind? }` shape used by `DestinationOptionsReader`
 * and `SourceOptionsReader` capabilities (#472) to populate the carrier-
 * mapping UI dropdowns. The `value` field is the stable identifier persisted
 * by mapping config (PrestaShop `id_reference`, Allegro `methodId`); `label`
 * is the human-readable string for FE rendering.
 *
 * The optional `kind` discriminator (#517) lets the FE decorate
 * runtime-dynamic options (e.g. the OpenLinker PrestaShop Dynamic carrier
 * which reads buyer-paid shipping from the sidecar table at order-total
 * time, #516). Static options omit `kind`. Open-extension: future kinds may
 * be added here without breaking the wire contract — the FE treats unknown
 * kinds as static.
 *
 * Mirrors the `MappingOptionResponseDto` shape so the API can return the
 * adapter result directly without remapping.
 *
 * @module libs/core/src/orders/domain/types
 */

/**
 * Behaviour kinds for a `MappingOption`. Today only `'dynamic'` is defined.
 * Static options omit `kind` entirely.
 */
export const MappingOptionKindValues = ['dynamic'] as const;
export type MappingOptionKind = (typeof MappingOptionKindValues)[number];

export interface MappingOption {
  /** Stable identifier persisted by mapping configuration. */
  value: string;
  /** Human-readable label for FE dropdowns. */
  label: string;
  /**
   * Optional behaviour discriminator. `'dynamic'` means the option's
   * shipping cost is computed at runtime by an external module (e.g. the
   * OpenLinker PS Dynamic carrier reads the sidecar table at order-total
   * time). Static options omit this field.
   */
  kind?: MappingOptionKind;
}
