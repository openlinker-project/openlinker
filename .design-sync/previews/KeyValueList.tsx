import { KeyValueList, StatusBadge } from '@openlinker/web';

/**
 * Ported from /dev/ui (primitives-section "KeyValueList & RawPayloadPanel").
 * `mono: true` is the only per-item axis — it switches the value to
 * `.key-value-list__value--mono`, which is how identifiers and money read as
 * data rather than prose.
 */

export const OrderSummary = () => (
  <KeyValueList
    items={[
      { id: 'internal', label: 'Internal id', mono: true, value: 'ol_order_a4f3b9c' },
      { id: 'external', label: 'External id', mono: true, value: 'ALG-2026-05-17-882414' },
      {
        id: 'channel',
        label: 'Channel',
        value: (
          <span className="channel-pill" data-channel="allegro">
            Allegro · Main
          </span>
        ),
      },
      { id: 'total', label: 'Total', mono: true, value: '€84.20' },
      {
        id: 'status',
        label: 'Status',
        value: (
          <StatusBadge tone="success" withDot>
            Paid
          </StatusBadge>
        ),
      },
      { id: 'created', label: 'Created', mono: true, value: '2026-05-17 14:22 UTC+02' },
    ]}
  />
);

export const ConnectionHealth = () => (
  <KeyValueList
    items={[
      { id: 'platform', label: 'Platform', value: 'WooCommerce' },
      { id: 'adapter', label: 'Adapter key', mono: true, value: 'woocommerce.restapi.v3' },
      {
        id: 'status',
        label: 'Status',
        value: (
          <StatusBadge tone="warning" withDot>
            Needs reauth
          </StatusBadge>
        ),
      },
      { id: 'lastPoll', label: 'Last poll', mono: true, value: '2026-05-17 13:58 UTC+02' },
      { id: 'lastOrder', label: 'Last order ingested', mono: true, value: '2026-05-16 21:04 UTC+02' },
    ]}
  />
);

export const ShipmentFacts = () => (
  <KeyValueList
    items={[
      { id: 'carrier', label: 'Carrier', value: 'InPost · Paczkomat' },
      { id: 'waybill', label: 'Waybill', mono: true, value: '621009441800340012' },
      { id: 'weight', label: 'Weight', mono: true, value: '1.85 kg' },
      { id: 'cod', label: 'Cash on delivery', mono: true, value: '€0.00' },
      {
        id: 'state',
        label: 'State',
        value: (
          <StatusBadge tone="info" withDot>
            In transit
          </StatusBadge>
        ),
      },
    ]}
  />
);
