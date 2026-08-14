/**
 * Invoicing query keys (#757, extended for #758 list)
 *
 * @module apps/web/src/features/invoicing/api
 */
import type { InvoiceFilters, InvoicePagination } from './invoicing.types';

export const invoicingQueryKeys = {
  all: ['invoicing'] as const,
  /**
   * The order's invoice, NOT scoped by connection (#2047). The key used to carry
   * the connection, which made "no invoice on the connection the operator just
   * picked" a cacheable answer that renders as "not issued" for an order that IS
   * invoiced elsewhere. One order has one invoice, so one cache entry.
   */
  forOrder: (orderId: string) => ['invoicing', 'order', orderId] as const,
  detail: (invoiceId: string) => ['invoicing', 'detail', invoiceId] as const,
  content: (invoiceId: string) => ['invoicing', 'content', invoiceId] as const,
  list: (filters?: InvoiceFilters, pagination?: InvoicePagination) =>
    ['invoicing', 'list', filters ?? {}, pagination ?? {}] as const,
};
