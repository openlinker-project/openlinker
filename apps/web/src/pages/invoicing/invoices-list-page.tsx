/**
 * Invoices List Page (#758, #1240 A1+C2+C3)
 *
 * Paginated `/invoices` list with the AC-6 filters (status, issued date range,
 * connection, regulatory/KSeF status) plus:
 *   - #1240 C2: taxId filter (with/without buyer tax ID)
 *   - #1240 C3: Connection column
 *   - rowHref → `/invoices/:id` (invoice detail page, #1240 A2)
 *   - Status column: derived via `deriveInvoiceDisplayStatus` (surfaces in-doubt)
 *   - Checkbox selection + BulkActionBar + ConfirmDialog for batch retry
 *   - Result banner after batch retry
 *
 * Structural mirror: `pages/webhook-deliveries/webhook-deliveries-page.tsx`
 * (layout, pagination, DataTable + cardView, feedback states, setFilter/setOffset
 * URL helpers). Enum-param reading + the date-range widen-to-UTC sub-pattern
 * come from `pages/orders/orders-list-page.tsx` (widen-then-narrow guards, NOT
 * the webhook blind cast). i18n via the `t()` seam.
 *
 * @module apps/web/src/pages/invoicing
 */
import { useState, useCallback, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { Alert } from '../../shared/ui/alert';
import { BulkActionBar } from '../../shared/ui/bulk-action-bar';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { Button } from '../../shared/ui/button';
import { Input } from '../../shared/ui/input';
import { Select } from '../../shared/ui/select';
import { TimeDisplay } from '../../shared/ui/time-display';
import { useTranslation } from '../../shared/i18n';
import { useInvoicesQuery } from '../../features/invoicing/hooks/use-invoices-query';
import { useRetryInvoicesMutation } from '../../features/invoicing/hooks/use-retry-invoices-mutation';
import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import { InvoiceStatusBadge } from '../../features/invoicing/components/invoice-status-badge';
import { RegulatoryStatusBadge } from '../../features/invoicing/components/regulatory-status-badge';
import { InvoicePdfLink } from '../../features/invoicing/components/invoice-pdf-link';
import { deriveInvoiceDisplayStatus } from '../../features/invoicing/lib/derive-invoice-display';
import {
  InvoiceStatusValues,
  RegulatoryStatusValues,
  type InvoiceFilters,
  type InvoiceRecord,
  type InvoiceStatus,
  type RegulatoryStatus,
} from '../../features/invoicing/api/invoicing.types';

const PAGE_SIZE = 20;

const TAX_ID_VALUES = ['with', 'without'] as const;
type TaxIdFilter = (typeof TAX_ID_VALUES)[number];

/** Widen-then-narrow guard for the `status` URL param. */
function isInvoiceStatus(value: string | null): value is InvoiceStatus {
  return value !== null && (InvoiceStatusValues as readonly string[]).includes(value);
}

/** Widen-then-narrow guard for the `regulatoryStatus` URL param. */
function isRegulatoryStatus(value: string | null): value is RegulatoryStatus {
  return value !== null && (RegulatoryStatusValues as readonly string[]).includes(value);
}

/** Widen-then-narrow guard for the `taxId` URL param. */
function isTaxIdFilter(value: string | null): value is TaxIdFilter {
  return value !== null && (TAX_ID_VALUES as readonly string[]).includes(value);
}

export function InvoicesListPage(): ReactElement {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  // Enum params
  const rawStatus = searchParams.get('status');
  const status = isInvoiceStatus(rawStatus) ? rawStatus : undefined;
  const rawRegulatory = searchParams.get('regulatoryStatus');
  const regulatoryStatus = isRegulatoryStatus(rawRegulatory) ? rawRegulatory : undefined;
  const rawTaxId = searchParams.get('taxId');
  const taxId = isTaxIdFilter(rawTaxId) ? rawTaxId : undefined;

  // Passthrough param
  const connectionId = searchParams.get('connectionId') ?? undefined;

  // Date range
  const issuedFrom = searchParams.get('issuedFrom') || undefined;
  const issuedTo = searchParams.get('issuedTo') || undefined;
  const issuedFromIso = issuedFrom ? `${issuedFrom}T00:00:00.000Z` : undefined;
  const issuedToIso = issuedTo ? `${issuedTo}T23:59:59.999Z` : undefined;

  const offset = Number(searchParams.get('offset') ?? '0');

  const filters: InvoiceFilters = {
    status,
    connectionId,
    regulatoryStatus,
    taxId,
    issuedFrom: issuedFromIso,
    issuedTo: issuedToIso,
  };
  const query = useInvoicesQuery(filters, { limit: PAGE_SIZE, offset });

  const connectionsQuery = useConnectionsQuery();
  const connections = connectionsQuery.data ?? [];
  const connectionMap = Object.fromEntries(connections.map((c) => [c.id, c.name]));

  // Batch retry state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [retryDialogOpen, setRetryDialogOpen] = useState(false);
  const [retryBanner, setRetryBanner] = useState<{ retried: number; skipped: number } | null>(null);
  const retryMutation = useRetryInvoicesMutation();

  function setFilter(key: string, value: string): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete('offset');
      return next;
    });
  }

  function setOffset(next: number): void {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === 0) p.delete('offset');
      else p.set('offset', String(next));
      return p;
    });
  }

  const toggleRow = useCallback((id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function handleRetryConfirm(): void {
    retryMutation.mutate(
      { invoiceIds: Array.from(selected) },
      {
        onSuccess: (result) => {
          setRetryBanner({ retried: result.retried, skipped: result.skipped });
          setSelected(new Set());
          setRetryDialogOpen(false);
        },
        onError: () => {
          setRetryDialogOpen(false);
        },
      },
    );
  }

  const columns: DataTableColumn<InvoiceRecord>[] = [
    {
      id: 'select',
      header: '',
      cell: (r) => (
        <input
          type="checkbox"
          aria-label={t('invoice.column.select', 'Select invoice')}
          checked={selected.has(r.id)}
          onChange={() => toggleRow(r.id)}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    },
    {
      id: 'orderId',
      header: t('invoice.column.orderId', 'Order'),
      cell: (r) => (
        <span className="mono-text" title={r.orderId}>
          {r.orderId}
        </span>
      ),
      accessor: (r) => r.orderId,
    },
    {
      id: 'invoiceNumber',
      header: t('invoice.column.invoiceNumber', 'Invoice no.'),
      cell: (r) =>
        r.providerInvoiceNumber ? (
          <InvoicePdfLink invoiceNumber={r.providerInvoiceNumber} pdfUrl={r.pdfUrl} />
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      id: 'documentType',
      header: t('invoice.column.documentType', 'Document type'),
      cell: (r) => (
        <span className="mono-text" title={r.documentType}>
          {r.documentType}
        </span>
      ),
      hideBelow: 768,
    },
    {
      id: 'status',
      header: t('invoice.column.status', 'Status'),
      // Derive display status (surfaces in-doubt vs failed split)
      cell: (r) => <InvoiceStatusBadge status={deriveInvoiceDisplayStatus(r)} />,
      accessor: (r) => deriveInvoiceDisplayStatus(r),
    },
    {
      id: 'regulatoryStatus',
      header: t('invoice.column.regulatory', 'Regulatory'),
      cell: (r) => <RegulatoryStatusBadge status={r.regulatoryStatus} />,
      hideBelow: 1024,
    },
    {
      id: 'clearanceRef',
      header: t('invoice.column.clearanceRef', 'KSeF no.'),
      cell: (r) =>
        r.clearanceReference ? (
          <span className="mono-text" title={r.clearanceReference}>
            {r.clearanceReference}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
      accessor: (r) => r.clearanceReference ?? '',
      hideBelow: 1280,
    },
    {
      id: 'connection',
      header: t('invoice.column.connection', 'Connection'),
      cell: (r) => (
        <span className="text-muted" title={r.connectionId}>
          {connectionMap[r.connectionId] ?? r.connectionId}
        </span>
      ),
      hideBelow: 1024,
    },
    {
      id: 'issuedAt',
      header: t('invoice.column.issuedAt', 'Issued'),
      cell: (r) =>
        r.issuedAt ? <TimeDisplay iso={r.issuedAt} format="date" /> : <span className="text-muted">—</span>,
      accessor: (r) => r.issuedAt ?? '',
    },
  ];

  const total = query.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;
  const hasFilters = Boolean(status || connectionId || regulatoryStatus || issuedFrom || issuedTo || taxId);

  return (
    <PageLayout
      eyebrow="Operations"
      title={t('invoice.list.title', 'Invoices')}
      description={t(
        'invoice.list.description',
        'Issued, pending, and failed invoices across connections, with regulatory (KSeF) status.',
      )}
    >
      {retryBanner ? (
        <Alert tone="success" className="invoice-list__retry-banner">
          {t('invoice.bulk.retryResult', 'Batch retry complete.')}{' '}
          {retryBanner.retried > 0
            ? t('invoice.bulk.retried', `${retryBanner.retried} retried.`)
            : null}{' '}
          {retryBanner.skipped > 0
            ? t('invoice.bulk.skipped', `${retryBanner.skipped} skipped (not eligible).`)
            : null}
          <Button
            tone="secondary"
            className="button--sm"
            style={{ marginLeft: '8px' }}
            onClick={() => setRetryBanner(null)}
          >
            {t('invoice.bulk.dismiss', 'Dismiss')}
          </Button>
        </Alert>
      ) : null}

      <div className="toolbar">
        <Select
          aria-label={t('invoice.filter.status', 'Filter by status')}
          value={status ?? ''}
          onChange={(e) => setFilter('status', e.target.value)}
        >
          <option value="">{t('invoice.filter.status.all', 'All statuses')}</option>
          {InvoiceStatusValues.map((s) => (
            <option key={s} value={s}>
              {t(`invoice.status.${s}`, s)}
            </option>
          ))}
        </Select>

        <Select
          aria-label={t('invoice.filter.regulatory', 'Filter by regulatory status')}
          value={regulatoryStatus ?? ''}
          onChange={(e) => setFilter('regulatoryStatus', e.target.value)}
        >
          <option value="">{t('invoice.filter.regulatory.all', 'All regulatory statuses')}</option>
          {/* Drop `not-applicable` (absence of regulatory tracking — noise as a
              filter) and `cleared` (reserved status no provider emits). */}
          {RegulatoryStatusValues.filter(
            (s) => s !== 'not-applicable' && s !== 'cleared',
          ).map((s) => (
            <option key={s} value={s}>
              {t(`invoice.regulatory.${s}`, s)}
            </option>
          ))}
        </Select>

        <Select
          aria-label={t('invoice.filter.connection', 'Filter by connection')}
          value={connectionId ?? ''}
          onChange={(e) => setFilter('connectionId', e.target.value)}
        >
          <option value="">{t('invoice.filter.connection.all', 'All connections')}</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>

        {/* C2: taxId filter */}
        <Select
          aria-label={t('invoice.filter.taxId', 'Filter by buyer tax ID')}
          value={taxId ?? ''}
          onChange={(e) => setFilter('taxId', e.target.value)}
        >
          <option value="">{t('invoice.filter.taxId.all', 'All buyer tax IDs')}</option>
          <option value="with">{t('invoice.filter.taxId.with', 'With tax ID')}</option>
          <option value="without">{t('invoice.filter.taxId.without', 'Without tax ID')}</option>
        </Select>

        <Input
          type="date"
          aria-label={t('invoice.filter.issuedFrom', 'Issued from')}
          value={issuedFrom ?? ''}
          onChange={(e) => setFilter('issuedFrom', e.target.value)}
        />
        <Input
          type="date"
          aria-label={t('invoice.filter.issuedTo', 'Issued to')}
          value={issuedTo ?? ''}
          onChange={(e) => setFilter('issuedTo', e.target.value)}
        />
      </div>

      {query.isLoading ? (
        <DataTableSkeleton columns={columns} />
      ) : query.error ? (
        <ErrorState
          title={t('invoice.list.error', 'Unable to load invoices')}
          message={query.error.message}
          action={
            <Button onClick={() => void query.refetch()}>
              {t('invoice.list.retry', 'Retry')}
            </Button>
          }
        />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          liveRegion="off"
          title={t('invoice.list.empty.title', 'No invoices found')}
          message={
            hasFilters
              ? t(
                  'invoice.list.empty.filtered',
                  'No invoices match the current filters. Try clearing some filters.',
                )
              : t('invoice.list.empty.none', 'No invoices have been issued yet.')
          }
        />
      ) : (
        <>
          <DataTable
            caption={t('invoice.list.caption', 'Invoices')}
            columns={columns}
            rows={query.data?.items ?? []}
            rowKey={(r) => r.id}
            rowHref={(r) => `/invoices/${r.id}`}
            cardView={{
              title: (r) => r.providerInvoiceNumber ?? r.orderId,
              subtitle: (r) => r.documentType,
              meta: (r) => <InvoiceStatusBadge status={deriveInvoiceDisplayStatus(r)} />,
            }}
          />

          <div className="pagination">
            <span className="text-muted">
              {t('invoice.list.pagination', 'Showing')} {offset + 1}–
              {Math.min(offset + PAGE_SIZE, total)} {t('invoice.list.paginationOf', 'of')} {total}
            </span>
            <div className="pagination__actions">
              <Button
                disabled={!hasPrev}
                onClick={() => setOffset(offset - PAGE_SIZE)}
              >
                {t('invoice.list.prev', 'Previous')}
              </Button>
              <Button
                disabled={!hasNext}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                {t('invoice.list.next', 'Next')}
              </Button>
            </div>
          </div>
        </>
      )}

      {/* C3: Batch retry bar — auto-hides when count=0 */}
      <BulkActionBar
        count={selected.size}
        itemNoun={t('invoice.bulk.itemNoun', 'invoice')}
        hint={t('invoice.bulk.hint', 'Only failed+rejected invoices will be retried; others are skipped.')}
        actions={
          <>
            <Button
              tone="secondary"
              className="button--sm"
              onClick={() => setSelected(new Set())}
            >
              {t('invoice.bulk.clear', 'Clear selection')}
            </Button>
            <Button
              tone="primary"
              className="button--sm"
              disabled={retryMutation.isPending}
              onClick={() => setRetryDialogOpen(true)}
            >
              {t('invoice.bulk.retry', 'Retry selected')}
            </Button>
          </>
        }
      />

      <ConfirmDialog
        open={retryDialogOpen}
        onOpenChange={setRetryDialogOpen}
        title={t('invoice.bulk.retryConfirmTitle', 'Retry invoices')}
        description={t(
          'invoice.bulk.retryConfirmBody',
          `Retry ${selected.size} selected invoice(s)? Only failed+rejected ones will actually be re-attempted; the rest will be skipped.`,
        )}
        confirmLabel={t('invoice.bulk.retryConfirmAction', 'Retry')}
        cancelLabel={t('invoice.bulk.retryCancel', 'Cancel')}
        tone="default"
        isConfirming={retryMutation.isPending}
        onConfirm={handleRetryConfirm}
      />
    </PageLayout>
  );
}
