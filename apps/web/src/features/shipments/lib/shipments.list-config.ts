/**
 * Shipments List Registry
 *
 * What the Shipments list declares to the saved-views engine (#4241): columns,
 * the filters a view owns, the sorts and the status views. Cell renderers are
 * passed in by the page; this file holds the declaration only.
 *
 * `processor` is deliberately NOT a view filter. It is a frontend abstraction
 * that `toShipmentProcessorFilters` expands into two backend filters, so the
 * address key is unknown to `ListShipmentsQueryDto` and a stored view carrying
 * it would be refused with a 400. The page lists it as a non-view param, and a
 * view that wants "carrier only" stores the real filter instead.
 *
 * @module apps/web/src/features/shipments/lib
 */
import { createElement, type ReactNode } from 'react';
import { SortField } from '../../../shared/ui/sort-field';
import type { ListRegistry, SystemViewDef, ViewHeaderContext } from '../../saved-views';
import {
  SHIPMENT_STATUS_VALUES,
  SHIPPING_METHOD_VALUES,
  type Shipment,
  type ShipmentStatus,
} from '../api/shipments.types';

export const SHIPMENTS_PAGE_KEY = 'shipments';

/** Address params that belong to the moment, not to a view (see the file header for `processor`). */
export const SHIPMENTS_NON_VIEW_PARAMS = ['processor'];

export interface ShipmentsListCopy {
  columns: { status: string; order: string; action: string; processor: string; method: string; customer: string; connection: string; created: string };
  statusTabs: { all: string; labels: Record<ShipmentStatus, string> };
  views: {
    fields: { method: string; processor: string };
    lockedDescription: string;
    sorts: { createdAsc: string; createdDesc: string; methodAsc: string; statusAsc: string };
  };
}

export interface ShipmentsListRenderers {
  status: (row: Shipment) => ReactNode;
  order: (row: Shipment) => ReactNode;
  action: (row: Shipment) => ReactNode;
  processor: (row: Shipment) => ReactNode;
  customer: (row: Shipment) => ReactNode;
  connection: (row: Shipment) => ReactNode;
  created: (row: Shipment) => ReactNode;
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

const SYSTEM_VIEW_ORDER: readonly ShipmentStatus[] = [
  'failed',
  'dispatched',
  'in-transit',
  'delivered',
  'cancelled',
  'draft',
  'generated',
];

export function createShipmentsListRegistry(
  copy: ShipmentsListCopy,
  render: ShipmentsListRenderers,
): ListRegistry<Shipment> {
  return {
    pageKey: SHIPMENTS_PAGE_KEY,
    extraNonViewParams: SHIPMENTS_NON_VIEW_PARAMS,
    locked: {
      id: 'status',
      label: copy.columns.status,
      description: copy.views.lockedDescription,
      header: (context) => sortHeader(context, 'status', copy.columns.status),
      sortKeys: ['status'],
      render: render.status,
      width: '17%',
    },
    columns: [
      { id: 'orderId', label: copy.columns.order, defaultVisible: true, header: copy.columns.order, render: render.order, width: '22%', lines: 2 },
      { id: 'action', label: copy.columns.action, defaultVisible: true, header: copy.columns.action, render: render.action, width: '8%' },
      {
        id: 'processor',
        label: copy.columns.processor,
        defaultVisible: true,
        width: '16%',
        lines: 2,
        // One cell, two header controls: a plain Processor label over a sortable Method. The cell
        // already folds the method under the badge, so the method is a header control only.
        parts: [{ id: 'processor', label: copy.views.fields.processor, headerLabel: copy.columns.processor, render: render.processor }],
        headerControls: [{ id: 'method', label: copy.columns.method, sort: 'shippingMethod' }],
      },
      { id: 'customerId', label: copy.columns.customer, defaultVisible: true, header: copy.columns.customer, render: render.customer, width: '12%', hideBelow: 768 },
      {
        id: 'connectionId',
        label: copy.columns.connection,
        defaultVisible: true,
        header: copy.columns.connection,
        render: render.connection,
        width: '12%',
        hideBelow: 1024,
      },
      {
        id: 'createdAt',
        label: copy.columns.created,
        defaultVisible: true,
        align: 'right',
        header: copy.columns.created,
        sortKey: 'createdAt',
        render: render.created,
        width: '13%',
      },
    ],
    filters: [
      { key: 'status', parse: (raw) => (SHIPMENT_STATUS_VALUES as readonly string[]).includes(raw) },
      { key: 'shippingMethod', parse: (raw) => (SHIPPING_METHOD_VALUES as readonly string[]).includes(raw) },
      { key: 'connectionId' },
      { key: 'hasTracking', parse: (raw) => raw === 'true' || raw === 'false' },
      { key: 'waybillRelayStuck', parse: (raw) => raw === 'true' },
      { key: 'createdFrom' },
      { key: 'createdTo' },
    ],
    sorts: [
      { key: 'createdAt', dir: 'desc', label: copy.views.sorts.createdDesc },
      { key: 'createdAt', dir: 'asc', label: copy.views.sorts.createdAsc },
      { key: 'status', dir: 'asc', label: copy.views.sorts.statusAsc },
      { key: 'shippingMethod', dir: 'asc', label: copy.views.sorts.methodAsc },
    ],
    defaultSort: { key: 'createdAt', dir: 'desc' },
    // Triage order, not lifecycle order: the first six are the strip, the last two live in the Views menu.
    systemViews: [
      { id: 'all', name: copy.statusTabs.all, query: '' },
      ...SYSTEM_VIEW_ORDER.map(
        (value): SystemViewDef => ({
          id: value,
          name: copy.statusTabs.labels[value],
          query: `status=${value}`,
          ...(value === 'failed' ? { tone: 'error' as const } : {}),
        }),
      ),
    ],
  };
}
