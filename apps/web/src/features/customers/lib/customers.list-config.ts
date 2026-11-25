/**
 * Customers List Registry
 *
 * What the Customers list declares to the saved-views engine (#4241): its
 * columns, the one filter a view owns, the sorts it offers and its single
 * built-in view. The cell renderers are passed in because they need the page's
 * batched connections read; this file holds only the declaration.
 *
 * Customers keeps built-in views only (`customViews: false`): a two-field
 * filter over a reference list does not earn named views, but the column and
 * sort choices are still the operator's to make.
 *
 * @module apps/web/src/features/customers/lib
 */
import { createElement, type ReactNode } from 'react';
import { SortField } from '../../../shared/ui/sort-field';
import { withColumnLayout } from '../../saved-views';
import type { ListRegistry, ViewHeaderContext } from '../../saved-views';
import type { CustomerProjection } from '../api/customers.types';

export const CUSTOMERS_PAGE_KEY = 'customers';

export interface CustomersListCopy {
  columns: { customer: string; customerId: string; lastSource: string; lastSeen: string };
  views: {
    lockedDescription: string;
    sorts: { lastSeenDesc: string; nameAsc: string };
    systemViews: { all: string };
  };
}

export interface CustomersListRenderers {
  customer: (row: CustomerProjection) => ReactNode;
  customerId: (row: CustomerProjection) => ReactNode;
  lastSource: (row: CustomerProjection) => ReactNode;
  lastSeen: (row: CustomerProjection) => ReactNode;
}

function sortHeader(context: ViewHeaderContext, key: string, label: string): ReactNode {
  const active = context.sort.key === key;
  return createElement(SortField, {
    label,
    active,
    dir: context.sort.dir,
    ariaLabel: context.sortLabel(label, active, context.sort.dir),
    onClick: () => context.onSort(key),
  });
}

/** Sort keys are the legacy column ids, so a bookmarked `?sort=name:asc` still resolves. */
export function createCustomersListRegistry(
  copy: CustomersListCopy,
  render: CustomersListRenderers,
): ListRegistry<CustomerProjection> {
  return {
    pageKey: CUSTOMERS_PAGE_KEY,
    customViews: false,
    locked: {
      id: 'name',
      label: copy.columns.customer,
      description: copy.views.lockedDescription,
      header: (context) => sortHeader(context, 'name', copy.columns.customer),
      sortKeys: ['name'],
      render: render.customer,
    },
    columns: withColumnLayout([
      {
        id: 'internalCustomerId',
        label: copy.columns.customerId,
        defaultVisible: true,
        header: copy.columns.customerId,
        render: render.customerId,
      },
      {
        id: 'lastSourceConnectionId',
        label: copy.columns.lastSource,
        defaultVisible: true,
        header: copy.columns.lastSource,
        render: render.lastSource,
      },
      {
        id: 'lastSeenAt',
        label: copy.columns.lastSeen,
        defaultVisible: true,
        header: copy.columns.lastSeen,
        sortKey: 'lastSeenAt',
        render: render.lastSeen,
      },
    ], { lines: { lastSourceConnectionId: 2 }, hideBelow: { lastSourceConnectionId: 768 } }),
    // Free text typed into the connection box is a legitimate view filter (the DTO accepts it);
    // `search` is the moment's text and is stripped as a non-view param.
    filters: [{ key: 'lastSourceConnectionId' }],
    sorts: [
      { key: 'lastSeenAt', dir: 'desc', label: copy.views.sorts.lastSeenDesc },
      { key: 'name', dir: 'asc', label: copy.views.sorts.nameAsc },
    ],
    defaultSort: { key: 'lastSeenAt', dir: 'desc' },
    systemViews: [{ id: 'all', name: copy.views.systemViews.all, query: '' }],
  };
}
