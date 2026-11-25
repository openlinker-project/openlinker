/**
 * Saved View Page Registry
 *
 * The list pages that may carry saved views, each with the existing list-query
 * DTO that validates its filter query. Core is page-agnostic (`pageKey` is an
 * opaque string there), so the registry lives here, in the interface layer: a
 * new list page is one entry in this file and changes nothing in the
 * saved-views context.
 *
 * Column and part ids are deliberately NOT registered: the frontend owns them,
 * and an unknown id in a stored view is reconciled on load rather than refused
 * on write. `failed-orders` and `dispatch-risk` are deferred.
 *
 * @module apps/api/src/saved-views
 */
import type { Type } from '@nestjs/common';
import { ListCustomersQueryDto } from '../customers/http/dto/list-customers-query.dto';
import { ListInvoicesQueryDto } from '../invoicing/http/dto/list-invoices-query.dto';
import { ListOfferMappingsQueryDto } from '../listings/http/dto/list-offer-mappings-query.dto';
import { ListOrdersQueryDto } from '../orders/http/dto/list-orders-query.dto';
import { ListSalesDocumentsQueryDto } from '../orders/http/dto/list-sales-documents-query.dto';
import { ListProductsQueryDto } from '../products/http/dto/list-products-query.dto';
import { ListReturnsQueryDto } from '../returns/dto/list-returns-query.dto';
import { ListShipmentsQueryDto } from '../shipping/http/dto/list-shipments-query.dto';
import { ListSyncJobsQueryDto } from '../sync/http/dto/list-sync-jobs-query.dto';
import { ListWebhookDeliveriesQueryDto } from '../webhooks/http/dto/list-webhook-deliveries-query.dto';

export const SAVED_VIEW_PAGE_KEY_FORMAT = /^[a-z][a-z0-9-]{1,63}$/;

/** The page's existing list DTO: a stored filter query must satisfy it exactly. */
export const SAVED_VIEW_PAGES = {
  customers: { queryDto: ListCustomersQueryDto },
  'webhook-deliveries': { queryDto: ListWebhookDeliveriesQueryDto },
  shipments: { queryDto: ListShipmentsQueryDto },
  'sales-documents': { queryDto: ListSalesDocumentsQueryDto },
  returns: { queryDto: ListReturnsQueryDto },
  invoices: { queryDto: ListInvoicesQueryDto },
  'sync-jobs': { queryDto: ListSyncJobsQueryDto },
  products: { queryDto: ListProductsQueryDto },
  listings: { queryDto: ListOfferMappingsQueryDto },
  orders: { queryDto: ListOrdersQueryDto },
} as const satisfies Record<string, { queryDto: Type<object> }>;

export type SavedViewPageKey = keyof typeof SAVED_VIEW_PAGES;

export const SAVED_VIEW_PAGE_KEYS = Object.keys(SAVED_VIEW_PAGES) as SavedViewPageKey[];

/**
 * Query keys that never belong in a saved view, whatever the page's DTO says.
 * `search` is free text a person typed (an email or a name): in a SHARED view it
 * would show every role someone's buyer data. The rest are position, not filter.
 */
export const SAVED_VIEW_STRIPPED_QUERY_KEYS = ['search', 'offset', 'cursor', 'limit', 'withTotal'] as const;
