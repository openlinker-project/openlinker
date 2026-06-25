/**
 * Invoicing query keys (#757, extended for #758 list)
 *
 * @module apps/web/src/features/invoicing/api
 */
import type { InvoiceFilters, InvoicePagination } from './invoicing.types';

export const invoicingQueryKeys = {
  all: ['invoicing'] as const,
  forOrder: (orderId: string, connectionId: string) =>
    ['invoicing', 'order', orderId, connectionId] as const,
  list: (filters?: InvoiceFilters, pagination?: InvoicePagination) =>
    ['invoicing', 'list', filters ?? {}, pagination ?? {}] as const,
};
