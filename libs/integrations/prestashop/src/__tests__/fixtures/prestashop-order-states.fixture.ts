/**
 * Default-install PrestaShop `order_states` rows (#2607)
 *
 * Trimmed to the fields the adapters read. Used by every spec that exercises a
 * status path, because since #2607 both directions resolve against the shop's
 * own state catalogue rather than a hardcoded id table.
 */
export const DEFAULT_INSTALL_ORDER_STATES: ReadonlyArray<Record<string, unknown>> = [
  {
    id: '1',
    name: 'Awaiting cheque payment',
    deleted: '0',
    paid: '0',
    shipped: '0',
    delivered: '0',
  },
  { id: '2', name: 'Payment accepted', deleted: '0', paid: '1', shipped: '0', delivered: '0' },
  {
    id: '3',
    name: 'Processing in progress',
    deleted: '0',
    paid: '1',
    shipped: '0',
    delivered: '0',
  },
  { id: '4', name: 'Shipped', deleted: '0', paid: '1', shipped: '1', delivered: '0' },
  { id: '5', name: 'Delivered', deleted: '0', paid: '1', shipped: '1', delivered: '1' },
  { id: '6', name: 'Canceled', deleted: '0', paid: '0', shipped: '0', delivered: '0' },
  { id: '7', name: 'Refunded', deleted: '0', paid: '0', shipped: '0', delivered: '0' },
  // Ids 8-13 also ship on a clean install. The removed 1-7 table swept every
  // one of them into `pending`, including the two that are paid, which is the
  // inbound half of what #2607 fixes.
  { id: '8', name: 'Payment error', deleted: '0', paid: '0', shipped: '0', delivered: '0' },
  { id: '9', name: 'On backorder (paid)', deleted: '0', paid: '1', shipped: '0', delivered: '0' },
  {
    id: '10',
    name: 'Awaiting bank wire payment',
    deleted: '0',
    paid: '0',
    shipped: '0',
    delivered: '0',
  },
  {
    id: '11',
    name: 'Remote payment accepted',
    deleted: '0',
    paid: '1',
    shipped: '0',
    delivered: '0',
  },
  {
    id: '12',
    name: 'On backorder (not paid)',
    deleted: '0',
    paid: '0',
    shipped: '0',
    delivered: '0',
  },
  {
    id: '13',
    name: 'Awaiting Cash on delivery validation',
    deleted: '0',
    paid: '0',
    shipped: '0',
    delivered: '0',
  },
];
