/**
 * Sales-document list query keys (#3307)
 *
 * @module apps/web/src/features/sales-documents/api
 */
import type { SalesDocumentListFilters } from './sales-document-list.types';

export const salesDocumentListQueryKeys = {
  all: ['sales-document-list'] as const,
  /**
   * `cursor` is included in the key (unlike `InvoiceRecord`'s offset-keyed
   * list, where each offset is its own cached page): each cursor value
   * addresses a distinct page of a keyset walk, so caching it is exactly
   * what lets "Back" restore a previously-fetched page for free.
   */
  list: (filters?: SalesDocumentListFilters, cursor?: string) =>
    ['sales-document-list', filters ?? {}, cursor ?? null] as const,
};
