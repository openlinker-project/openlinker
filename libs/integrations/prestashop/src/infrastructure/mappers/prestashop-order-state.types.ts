/**
 * PrestaShop Order-State Constants
 *
 * Numeric PrestaShop `order_state` ids the adapters key on. PrestaShop ships a
 * fixed set of default order states on a clean install; this module names the
 * one the order-source feed needs so the magic number doesn't sit inline.
 *
 * Scope: the **default-install** state ids. Installs that renumber order states
 * are a documented v1 limitation (#1161) — the robust path is name resolution
 * via `GET /order_states` (see `prestashop-order-processor-manager.adapter.ts`
 * `resolveStateId`), deliberately out of scope for the hot feed path.
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers
 * @see {@link PrestashopOrderMapper.mapOrderStatus} for the sibling id→status table
 */

/**
 * Default-install PrestaShop id for the "Canceled" order state. Used by the
 * order-source feed to emit a `cancelled` OrderFeedEventType (#1161).
 */
export const PRESTASHOP_DEFAULT_CANCELLED_STATE_ID = 6;
