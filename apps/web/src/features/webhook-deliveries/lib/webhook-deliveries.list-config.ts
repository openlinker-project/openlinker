/**
 * Webhook Deliveries List Registry
 *
 * What the Webhook Deliveries list declares to the saved-views engine (#4241):
 * columns, the filters a view owns, the sorts and the four built-in views.
 * Cell renderers are passed in by the page; this file holds the declaration
 * only. Built-in views only (`customViews: false`): this is a diagnostics
 * list read by operators, not a worklist someone curates.
 *
 * @module apps/web/src/features/webhook-deliveries/lib
 */
import { createElement, type ReactNode } from 'react';
import { SortField } from '../../../shared/ui/sort-field';
import { withColumnLayout } from '../../saved-views';
import type { ListRegistry, ViewHeaderContext } from '../../saved-views';
import {
  WEBHOOK_DELIVERY_STATUS_VALUES,
  type WebhookDeliverySummary,
} from '../api/webhook-deliveries.types';

export const WEBHOOK_DELIVERIES_PAGE_KEY = 'webhook-deliveries';

export interface WebhookDeliveriesListCopy {
  columns: { status: string; provider: string; eventType: string; connection: string; reason: string; received: string };
  views: {
    lockedDescription: string;
    sorts: { providerAsc: string; receivedAsc: string; receivedDesc: string; statusAsc: string };
    systemViews: { all: string; deadlettered: string; failed: string; rejected: string };
  };
}

export interface WebhookDeliveriesListRenderers {
  status: (row: WebhookDeliverySummary) => ReactNode;
  provider: (row: WebhookDeliverySummary) => ReactNode;
  eventType: (row: WebhookDeliverySummary) => ReactNode;
  connection: (row: WebhookDeliverySummary) => ReactNode;
  reason: (row: WebhookDeliverySummary) => ReactNode;
  received: (row: WebhookDeliverySummary) => ReactNode;
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

/** Sort keys are the legacy column ids, so a bookmarked `?sort=receivedAt:asc` still resolves. */
export function createWebhookDeliveriesListRegistry(
  copy: WebhookDeliveriesListCopy,
  render: WebhookDeliveriesListRenderers,
): ListRegistry<WebhookDeliverySummary> {
  return {
    pageKey: WEBHOOK_DELIVERIES_PAGE_KEY,
    customViews: false,
    locked: {
      id: 'status',
      label: copy.columns.status,
      description: copy.views.lockedDescription,
      header: (context) => sortHeader(context, 'status', copy.columns.status),
      sortKeys: ['status'],
      render: render.status,
    },
    columns: withColumnLayout([
      {
        id: 'provider',
        label: copy.columns.provider,
        defaultVisible: true,
        header: copy.columns.provider,
        sortKey: 'provider',
        render: render.provider,
      },
      {
        id: 'eventType',
        label: copy.columns.eventType,
        defaultVisible: true,
        header: copy.columns.eventType,
        render: render.eventType,
      },
      {
        id: 'connectionId',
        label: copy.columns.connection,
        defaultVisible: true,
        header: copy.columns.connection,
        render: render.connection,
      },
      {
        id: 'reason',
        label: copy.columns.reason,
        defaultVisible: true,
        header: copy.columns.reason,
        render: render.reason,
      },
      {
        id: 'receivedAt',
        label: copy.columns.received,
        defaultVisible: true,
        header: copy.columns.received,
        sortKey: 'receivedAt',
        render: render.received,
      },
    ], { hideBelow: { eventType: 768, connectionId: 1024, reason: 1024 } }),
    filters: [
      { key: 'status', parse: (raw) => (WEBHOOK_DELIVERY_STATUS_VALUES as readonly string[]).includes(raw) },
      { key: 'provider' },
      { key: 'connectionId' },
    ],
    sorts: [
      { key: 'receivedAt', dir: 'desc', label: copy.views.sorts.receivedDesc },
      { key: 'receivedAt', dir: 'asc', label: copy.views.sorts.receivedAsc },
      { key: 'status', dir: 'asc', label: copy.views.sorts.statusAsc },
      { key: 'provider', dir: 'asc', label: copy.views.sorts.providerAsc },
    ],
    defaultSort: { key: 'receivedAt', dir: 'desc' },
    systemViews: [
      { id: 'all', name: copy.views.systemViews.all, query: '' },
      { id: 'failed', name: copy.views.systemViews.failed, query: 'status=failed', tone: 'error' },
      { id: 'rejected', name: copy.views.systemViews.rejected, query: 'status=rejected', tone: 'error' },
      { id: 'deadlettered', name: copy.views.systemViews.deadlettered, query: 'status=deadlettered', tone: 'error' },
    ],
  };
}
