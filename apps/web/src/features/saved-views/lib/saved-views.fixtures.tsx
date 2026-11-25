/**
 * Saved Views Test Fixtures
 *
 * A small registry shaped like the Orders list: a locked identity column, a
 * stacked column with sortable fields, single-field columns, a few filters.
 *
 * @module apps/web/src/features/saved-views/lib
 */
import type { ListRegistry } from './view-registry.types';

// Plain constants: this module is not operator copy, only recognisable strings for assertions.
const PAID = 'Paid';
const TODAY = 'today';
const VIP = 'vip';

export interface TestRow {
  id: number;
  customer: string;
  total: number;
}

export const testRegistry: ListRegistry<TestRow> = {
  pageKey: 'orders',
  locked: {
    id: 'order',
    label: 'Order',
    description: 'Number, item',
    header: 'Order',
    render: (row) => <span>{`#${row.id}`}</span>,
  },
  columns: [
    { id: 'customer', label: 'Customer', defaultVisible: true, header: 'Customer', render: (row) => <span>{row.customer}</span> },
    {
      id: 'total',
      label: 'Total, payment, dates',
      defaultVisible: true,
      align: 'right',
      parts: [
        { id: 'amount', label: 'Total', sort: 'total', headerLabel: 'Total', render: (row) => <b>{row.total}</b> },
        { id: 'payment', label: 'Payment', sort: 'pay', headerLabel: 'Payment', render: () => <i>{PAID}</i> },
        { id: 'created', label: 'Created', render: () => <u>{TODAY}</u> },
      ],
    },
    { id: 'stock', label: 'Stock', defaultVisible: false, header: 'Stock', description: 'On hand', render: () => <span>1</span> },
    { id: 'tags', label: 'Tags', defaultVisible: false, header: 'Tags', sortKey: 'tags', render: () => <span>{VIP}</span> },
  ],
  filters: [
    { key: 'stage' },
    { key: 'source', parse: (raw) => ['Shopify', 'Allegro'].includes(raw) },
    { key: 'gift' },
  ],
  sorts: [
    { key: 'created', dir: 'desc', label: 'Created, newest' },
    { key: 'total', dir: 'desc', label: 'Total, high to low' },
    { key: 'pay', dir: 'desc', label: 'Payment, paid first' },
    { key: 'tags', dir: 'asc', label: 'Tags' },
  ],
  defaultSort: { key: 'created', dir: 'desc' },
  systemViews: [
    { id: 'all', name: 'All orders', query: '' },
    { id: 'attention', name: 'Needs attention', query: 'stage=failed', tone: 'error' },
    { id: 'gift', name: 'Gift orders', query: 'gift=1' },
  ],
};
