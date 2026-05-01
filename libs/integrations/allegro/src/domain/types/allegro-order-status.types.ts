/**
 * Allegro Order Status Enum (#472)
 *
 * Allegro **does not expose** a live `/sale/order-statuses` endpoint — these
 * values are documented in the checkout-form section of Allegro's developer
 * docs. The list captures the statuses an incoming `checkoutForm` can carry.
 *
 * Drift is detected by the `mapAllegroEventType` warn-log in
 * `AllegroOrderSourceAdapter.listOrderFeed` — if Allegro ever ships a status
 * not in this list it'll surface as "unknown event type X" in worker logs.
 *
 * **Captured 2026-05-01** from https://developer.allegro.pl/about/#section/Authentication
 * (checkout-form schema). Update this comment + the values below if Allegro
 * changes the documented enum.
 *
 * The `value` field is the literal Allegro status string persisted by mapping
 * config; `label` is the operator-facing English name. Localisation is
 * out-of-scope for v1 — once OpenLinker grows a workspace-language setting
 * the labels will be translated.
 *
 * @module libs/integrations/allegro/src/domain/types
 */

import type { MappingOption } from '@openlinker/core/orders';

export const ALLEGRO_ORDER_STATUS_OPTIONS: ReadonlyArray<MappingOption> = [
  { value: 'BOUGHT', label: 'Bought (awaiting payment)' },
  { value: 'FILLED_IN', label: 'Filled in (buyer added shipping details)' },
  { value: 'READY_FOR_PROCESSING', label: 'Ready for processing (paid)' },
  { value: 'CANCELLED', label: 'Cancelled' },
];
