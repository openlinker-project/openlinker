/**
 * Invoices List Page (#758)
 *
 * Paginated `/invoices` list with the AC-6 filters (status, issued date range,
 * connection, regulatory/KSeF status). Server state → TanStack Query
 * (`useInvoicesQuery`); filter + pagination state → URL search params.
 *
 * Structural mirror: `pages/webhook-deliveries/webhook-deliveries-page.tsx`
 * (layout, pagination, DataTable + cardView, feedback states, setFilter/setOffset
 * URL helpers). Enum-param reading + the date-range widen-to-UTC sub-pattern
 * come from `pages/orders/orders-list-page.tsx` (widen-then-narrow guards, NOT
 * the webhook blind cast). i18n via the `t()` seam (deliberate #758 deviation
 * from the mirror — see the plan's reviewer-facing caveat).
 *
 * @module apps/web/src/pages/invoicing
 */
import type { ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { Button } from '../../shared/ui/button';
import { Input } from '../../shared/ui/input';
import { Select } from '../../shared/ui/select';
import { TimeDisplay } from '../../shared/ui/time-display';
import { useTranslation } from '../../shared/i18n';
import { useInvoicesQuery } from '../../features/invoicing/hooks/use-invoices-query';
import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import { InvoiceStatusBadge } from '../../features/invoicing/components/invoice-status-badge';
import { RegulatoryStatusBadge } from '../../features/invoicing/components/regulatory-status-badge';
import { InvoicePdfLink } from '../../features/invoicing/components/invoice-pdf-link';
import {
  InvoiceStatusValues,
  RegulatoryStatusValues,
  type InvoiceFilters,
  type InvoiceRecord,
  type InvoiceStatus,
  type RegulatoryStatus,
} from '../../features/invoicing/api/invoicing.types';

const PAGE_SIZE = 20;

/** Widen-then-narrow guard for the `status` URL param (orders pattern — NOT a
 *  blind cast). Rejects crafted/typo values so they never reach the query or
 *  bind to a non-existent `<option>`. */
function isInvoiceStatus(value: string | null): value is InvoiceStatus {
  return value !== null && (InvoiceStatusValues as readonly string[]).includes(value);
}

/** Widen-then-narrow guard for the `regulatoryStatus` URL param. */
function isRegulatoryStatus(value: string | null): value is RegulatoryStatus {
  return value !== null && (RegulatoryStatusValues as readonly string[]).includes(value);
}

export function InvoicesListPage(): ReactElement {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  // Enum params: read raw, narrow via the guards, fall back to undefined ("All").
  const rawStatus = searchParams.get('status');
  const status = isInvoiceStatus(rawStatus) ? rawStatus : undefined;
  const rawRegulatory = searchParams.get('regulatoryStatus');
  const regulatoryStatus = isRegulatoryStatus(rawRegulatory) ? rawRegulatory : undefined;

  // Passthrough param (backend @IsUUID gates it; stale id simply shows no match).
  const connectionId = searchParams.get('connectionId') ?? undefined;

  // Date range: store YYYY-MM-DD in the URL, widen to UTC instants for the query
  // (inclusive upper bound). Empty string collapses to undefined.
  const issuedFrom = searchParams.get('issuedFrom') || undefined;
  const issuedTo = searchParams.get('issuedTo') || undefined;
  const issuedFromIso = issuedFrom ? `${issuedFrom}T00:00:00.000Z` : undefined;
  const issuedToIso = issuedTo ? `${issuedTo}T23:59:59.999Z` : undefined;

  const offset = Number(searchParams.get('offset') ?? '0');

  const filters: InvoiceFilters = {
    status,
    connectionId,
    regulatoryStatus,
    issuedFrom: issuedFromIso,
    issuedTo: issuedToIso,
  };
  const query = useInvoicesQuery(filters, { limit: PAGE_SIZE, offset });

  const connectionsQuery = useConnectionsQuery();
  const connections = connectionsQuery.data ?? [];

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

  const columns: DataTableColumn<InvoiceRecord>[] = [
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
      // Pending/failed rows have a null `providerInvoiceNumber`; fall back to the
      // em-dash convention (matches the `issuedAt` column + webhook page) rather
      // than rendering a visibly empty cell.
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
      cell: (r) => <InvoiceStatusBadge status={r.status} />,
      accessor: (r) => r.status,
    },
    {
      id: 'regulatoryStatus',
      header: t('invoice.column.regulatory', 'Regulatory'),
      // Render the badge for ALL rows incl. `not-applicable` (→ neutral "N/A");
      // do NOT replicate the panel's not-applicable gate (that is a single-invoice
      // design choice, not a constraint of the badge).
      cell: (r) => <RegulatoryStatusBadge status={r.regulatoryStatus} />,
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
  const hasFilters = Boolean(status || connectionId || regulatoryStatus || issuedFrom || issuedTo);

  return (
    <PageLayout
      eyebrow="Operations"
      title={t('invoice.list.title', 'Invoices')}
      description={t(
        'invoice.list.description',
        'Issued, pending, and failed invoices across connections, with regulatory (KSeF) status.',
      )}
    >
      <div className="toolbar">
        <Select
          aria-label={t('invoice.filter.status', 'Filter by status')}
          value={status ?? ''}
          onChange={(e) => {
            setFilter('status', e.target.value);
          }}
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
          onChange={(e) => {
            setFilter('regulatoryStatus', e.target.value);
          }}
        >
          <option value="">{t('invoice.filter.regulatory.all', 'All regulatory statuses')}</option>
          {RegulatoryStatusValues.map((s) => (
            <option key={s} value={s}>
              {t(`invoice.regulatory.${s}`, s)}
            </option>
          ))}
        </Select>

        <Select
          aria-label={t('invoice.filter.connection', 'Filter by connection')}
          value={connectionId ?? ''}
          onChange={(e) => {
            setFilter('connectionId', e.target.value);
          }}
        >
          <option value="">{t('invoice.filter.connection.all', 'All connections')}</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>

        <Input
          type="date"
          aria-label={t('invoice.filter.issuedFrom', 'Issued from')}
          value={issuedFrom ?? ''}
          onChange={(e) => {
            setFilter('issuedFrom', e.target.value);
          }}
        />
        <Input
          type="date"
          aria-label={t('invoice.filter.issuedTo', 'Issued to')}
          value={issuedTo ?? ''}
          onChange={(e) => {
            setFilter('issuedTo', e.target.value);
          }}
        />
      </div>

      {query.isLoading ? (
        <DataTableSkeleton columns={columns} />
      ) : query.error ? (
        <ErrorState
          title={t('invoice.list.error', 'Unable to load invoices')}
          message={query.error.message}
          action={
            <Button
              onClick={() => {
                void query.refetch();
              }}
            >
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
            rowHref={(r) => `/orders/${r.orderId}`}
            cardView={{
              title: (r) => r.providerInvoiceNumber ?? r.orderId,
              subtitle: (r) => r.documentType,
              meta: (r) => <InvoiceStatusBadge status={r.status} />,
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
                onClick={() => {
                  setOffset(offset - PAGE_SIZE);
                }}
              >
                {t('invoice.list.prev', 'Previous')}
              </Button>
              <Button
                disabled={!hasNext}
                onClick={() => {
                  setOffset(offset + PAGE_SIZE);
                }}
              >
                {t('invoice.list.next', 'Next')}
              </Button>
            </div>
          </div>
        </>
      )}
    </PageLayout>
  );
}
