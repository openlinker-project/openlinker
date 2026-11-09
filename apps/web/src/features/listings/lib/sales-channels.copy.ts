/**
 * Sales Channels Copy (#3962)
 *
 * Operator-facing words for the product page's "Sales channels" section:
 * where a product deleted at the source is still on sale, and what
 * OpenLinker did. One module so the section, its tests and the products
 * banner say the same thing.
 *
 * @module apps/web/src/features/listings/lib
 */

export const SALES_CHANNELS_COPY = {
  kicker: 'Sales channels',
  checked: (time: string): string => `Checked ${time}`,
  onSale: (subject: string | null, selling: number, total: number): string => {
    const where = `on ${selling} of ${total} channel${total === 1 ? '' : 's'}`;
    return subject ? `${subject} is on sale ${where}` : `On sale ${where}`;
  },
  offSaleEverywhere: (total: number): string => `Off sale on all ${total} channel${total === 1 ? '' : 's'}`,
  backAtSource: (source: string): string => `Back in ${source}, not on sale anywhere`,
  inStockAtSource: (source: string): string => `Stock comes from ${source}.`,
  ordersSince: (count: number): string =>
    count === 0 ? 'No orders since deletion' : `${count} order${count === 1 ? '' : 's'} since deletion`,
  sizeNote: 'A shop can only hide the whole product, so the deleted variant is set to 0',
  needsAction: 'Needs action',
  stopped: 'Stopped',
  showChannels: 'Show channels',
  hideChannels: 'Hide channels',
  putBack: (count: number): string =>
    `Put back on sale on ${count} channel${count === 1 ? '' : 's'}`,
  putBackFailed: 'Some channels could not be put back on sale. Try again.',
  putBackRefused: 'It is still deleted at the source, so it cannot go back on sale yet.',
  turnOnStockSync: 'Turn on stock sync',
  turnOffIn: (platform: string): string => `Turn off in ${platform}`,
  offerRef: (platform: string, kind: 'Offer' | 'ShopProduct', externalId: string): string =>
    `${platform}, ${kind === 'Offer' ? `offer ${externalId}` : `product #${externalId}`}`,
  reason: {
    stock_sync_off: 'Stock sync is off',
    no_stock_write: (platform: string): string => `OpenLinker can not change stock in ${platform}`,
    error: 'Could not stop the sale. OpenLinker tries again every hour.',
    notYet: 'Not stopped yet. OpenLinker checks every hour.',
  },
  quantity: (qty: number): string => `${qty} in stock`,
  cannotBeBought: 'cannot be bought',
  since: (date: string): string => `since ${date}`,
} as const;

/** The channel's own status word, as the operator knows it from that channel. */
export const CHANNEL_STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  activating: 'Activating',
  inactivating: 'Deactivating',
  inactive: 'Inactive',
  ended: 'Ended',
  published: 'On sale',
  draft: 'Draft',
  unpublished: 'Turned off',
  removed: 'Removed',
};
