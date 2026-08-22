import { DataTable, EntityLabel, StatusBadge } from '@openlinker/web';

/**
 * Ported from the cockpit list-page reference at /dev/ui
 * (apps/web/src/pages/dev-ui/sections/patterns-section.tsx): identity column via
 * EntityLabel, status via StatusBadge, mono + tabular figures on every numeric.
 * That composition — not a bare table — is how DataTable is actually used.
 */

const ORDERS = [
  { id: '1', createdAt: '2026-05-17 14:22', internalId: 'ol_order_9f3a', externalId: '#10482', channel: 'Allegro · Main', buyer: 'K. Nowak', total: '€84.20', status: 'success', statusLabel: 'Paid' },
  { id: '2', createdAt: '2026-05-17 13:58', internalId: 'ol_order_7c11', externalId: '#10481', channel: 'Erli', buyer: 'M. Kowalczyk', total: '€132.00', status: 'warning', statusLabel: 'Awaiting stock' },
  { id: '3', createdAt: '2026-05-17 13:04', internalId: 'ol_order_2b8d', externalId: '#10480', channel: 'Allegro · Main', buyer: 'A. Zieliński', total: '€19.99', status: 'error', statusLabel: 'Failed' },
  { id: '4', createdAt: '2026-05-17 12:41', internalId: 'ol_order_5e60', externalId: '#10479', channel: 'WooCommerce', buyer: 'P. Wójcik', total: '€248.50', status: 'success', statusLabel: 'Paid' },
];

const mono = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' as const };

const COLUMNS = [
  {
    id: 'createdAt',
    header: 'Created',
    cell: (row: (typeof ORDERS)[number]) => (
      <span style={{ ...mono, color: 'var(--text-secondary)' }}>{row.createdAt}</span>
    ),
  },
  {
    id: 'order',
    header: 'Order',
    cell: (row: (typeof ORDERS)[number]) => <EntityLabel id={row.internalId} name={row.externalId} />,
  },
  { id: 'channel', header: 'Channel', cell: (row: (typeof ORDERS)[number]) => row.channel },
  { id: 'buyer', header: 'Buyer', cell: (row: (typeof ORDERS)[number]) => row.buyer },
  {
    id: 'total',
    header: 'Total',
    cell: (row: (typeof ORDERS)[number]) => <span style={mono}>{row.total}</span>,
  },
  {
    id: 'status',
    header: 'Status',
    cell: (row: (typeof ORDERS)[number]) => (
      <StatusBadge tone={row.status} withDot>{row.statusLabel}</StatusBadge>
    ),
  },
];

export const OrdersCockpit = () => (
  <DataTable caption="Recent orders" columns={COLUMNS} rows={ORDERS} rowKey={(row) => row.id} />
);

export const Empty = () => (
  <DataTable
    caption="Recent orders"
    columns={COLUMNS}
    rows={[]}
    rowKey={(row) => row.id}
    emptyState="No orders in the selected window."
  />
);
