/**
 * Invoicing query keys (#757)
 *
 * @module apps/web/src/features/invoicing/api
 */
export const invoicingQueryKeys = {
  all: ['invoicing'] as const,
  forOrder: (orderId: string, connectionId: string) =>
    ['invoicing', 'order', orderId, connectionId] as const,
};
