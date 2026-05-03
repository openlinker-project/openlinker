/**
 * PrestaShop Options Types (#472)
 *
 * Response shapes for the two PS WS list endpoints powering
 * `DestinationOptionsReader` on `PrestashopOrderProcessorManagerAdapter`:
 * `/carriers` and `/order_states`. Only the fields the adapter actually
 * consumes are typed — PS WS returns much more, but we ignore the rest to
 * keep the surface tight.
 *
 * `/modules` was removed in #483: PS Webservice keys are not granted access
 * to that resource by default, so payment modules are sourced from a curated
 * list (`PRESTASHOP_PAYMENT_MODULES`) instead. See
 * `prestashop-payment-module.types.ts`.
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
 *
 * `external_module_name` is non-empty when the carrier is installed by a PS
 * carrier module (`is_module=1`, `shipping_external=1`). For OpenLinker's
 * Dynamic carrier (#515 / #516) the value is the literal string `'openlinker'`;
 * the adapter uses it to mark the matching `MappingOption` with
 * `kind: 'dynamic'`. Static carriers leave it empty.
 */
export interface PrestashopCarrier {
  id: string;
  id_reference: string;
  name: PrestashopLanguageField;
  active: string | number;
  deleted: string | number;
  external_module_name?: string;
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

