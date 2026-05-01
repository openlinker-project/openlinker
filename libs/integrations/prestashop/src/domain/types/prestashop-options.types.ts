/**
 * PrestaShop Options Types (#472)
 *
 * Response shapes for the three PS WS list endpoints powering
 * `DestinationOptionsReader` on `PrestashopOrderProcessorManagerAdapter`:
 * `/carriers`, `/order_states`, and `/modules`. Only the fields the adapter
 * actually consumes are typed — PS WS returns much more, but we ignore the
 * rest to keep the surface tight.
 *
 * @module libs/integrations/prestashop/src/domain/types
 */

/**
 * Multi-language field shape PS WS returns when language pinning isn't
 * configured. The adapter's `flattenLanguageField` helper unwraps this back
 * to a flat string (taking the first language entry).
 */
export type PrestashopLanguageField =
  | string
  | { language?: Array<{ '#text'?: string; value?: string }> };

/**
 * `GET /carriers` row.
 *
 * `id_reference` is the **stable** identifier for cross-edit lookups —
 * `id_carrier` mutates whenever the operator edits a carrier. Mappings persist
 * `id_reference`. `active=1` and `deleted=0` are the active-and-extant filter
 * (PS soft-deletes carriers rather than hard-removing).
 */
export interface PrestashopCarrier {
  id: string;
  id_reference: string;
  name: PrestashopLanguageField;
  active: string | number;
  deleted: string | number;
}

/**
 * `GET /order_states` row. `name` may be a flat string (single-lang PS
 * config) or the multi-lang shape (`{ language: [{ '#text': … }] }`).
 */
export interface PrestashopOrderState {
  id: string;
  name: PrestashopLanguageField;
  deleted: string | number;
}

/**
 * `GET /modules` row.
 *
 * The relevant fields for "which payment gateways does this PS install
 * have?" are `active`, `name` (machine code persisted by mapping config),
 * `displayName` / `display_name` (human label), and the payment-module
 * indicator. PS WS exposes the indicator differently across versions:
 *   - PS 1.7+: a top-level boolean `is_payment_module` on the module row
 *   - older PS: the module's `tab` field equals `'payments_gateways'`
 * The adapter treats either signal as truthy and falls through to "include
 * the module" if neither is present (lets the operator pick from a wider
 * list rather than silently dropping legitimate gateways).
 */
export interface PrestashopModule {
  id: string;
  name: string;
  /** Display name — PS WS sometimes uses snake_case, sometimes camelCase. */
  displayName?: PrestashopLanguageField;
  display_name?: PrestashopLanguageField;
  active: string | number;
  /** PS 1.7+ payment-module indicator. */
  is_payment_module?: string | number | boolean;
  /** Older PS module-category indicator. */
  tab?: string;
}
