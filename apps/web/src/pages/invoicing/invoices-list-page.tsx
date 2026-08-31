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
 * #2090 (epic #2086):
 *   - `invoiceNumber` + `documentType` merged into one `Document type` column
 *     (9 -> 8): the provider number over a LABELLED type, `Not yet issued` when
 *     the record carries neither. The column deliberately has no `hideBelow` —
 *     it hosts #2094's tablet fold of the connection.
 *   - Order column -> the shared `OrderIdentityCell`, fed from `orderSummary`
 *   - Connection column -> the shared `ConnectionCell` (no adornment), replacing
 *     an id hidden in a `title` attribute
 *   - One desktop renderer and one CARD renderer per identity fact. They cannot
 *     be the same function: `DataTableCard` wraps title + subtitle in the row's
 *     `<Link>` (this page sets `rowHref`), so the card's versions are text-only.
 *     Both share the label helper and the same shortening, so neither can drift
 *     back to printing a raw order UUID.
 *
 * Structural mirror: `pages/webhook-deliveries/webhook-deliveries-page.tsx`
 * (layout, pagination, DataTable + cardView, feedback states, setFilter/setOffset
 * URL helpers). Enum-param reading + the date-range widen-to-UTC sub-pattern
 * come from `pages/orders/orders-list-page.tsx` (widen-then-narrow guards, NOT
 * the webhook blind cast). i18n via the `t()` seam.
 *
 * @module apps/web/src/pages/invoicing
 */
import { useState, useCallback, useMemo, type ReactElement } from 'react';
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
import { CopyableId } from '../../shared/ui/copyable-id';
import { EmptyValue } from '../../shared/ui/empty-value';
import { isSafeHttpUrl } from '../../shared/lib/is-safe-http-url';
import { shortenId } from '../../shared/ui/entity-label';
import { useTranslation } from '../../shared/i18n';
import {
  deriveInvoiceDisplayStatus,
  useBulkIssueInvoicesMutation,
  useRetryInvoicesMutation,
  useInvoicesQuery,
  InvoiceStatusBadge,
  RegulatoryStatusBadge,
  REGULATORY_STATUS_LABEL_FALLBACK,
  InvoicePdfLink,
  InvoiceStatusValues,
  RegulatoryStatusValues,
  type InvoiceFilters,
  type InvoiceRecord,
  type InvoiceStatus,
  type RegulatoryStatus,
  DOCUMENT_TYPE_LABEL_FALLBACK,
  DOCUMENT_TYPE_UNKNOWN_LABEL,
} from '../../features/invoicing';
import { ConnectionCell, ConnectionFold, useConnectionsQuery } from '../../features/connections';
import { OrderIdentityCell, formatOrderRef } from '../../features/orders';

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
  // `{ name, status }`, not just the name: that is `ConnectionCellFacts`, and
  // supplying only part of it used to leave the cell's status note unresolved on
  // exactly the batched path #1996 requires (#2027). A Map so a miss coalesces to
  // `null` — `undefined` reads as "resolve it yourself" and reinstates a per-row
  // fetch.
  const connectionsById = useMemo(
    () => new Map(connections.map((c) => [c.id, { name: c.name, status: c.status }])),
    [connections],
  );

  // Two renderers per identity fact: one for the desktop column, one text-only
  // for the mobile card (see `renderDocumentCardTitle` for why they cannot be the
  // same function). The card used to headline `providerInvoiceNumber ?? r.orderId`
  // — the raw 41-character UUID this issue exists to remove — on every row without
  // a provider number, i.e. every pending / issuing / failed row.
  //
  // What IS single-sourced across the pair: the document-type label
  // (`documentTypeLabel`) and the order-number shortening (`formatOrderRef`,
  // exported from `features/orders` for exactly this reason). Those are the two
  // places the desktop and card renderings could silently disagree.
  const documentTypeLabel = (r: InvoiceRecord): string =>
    r.documentType
      ? t(
          `invoice.documentType.${r.documentType}`,
          DOCUMENT_TYPE_LABEL_FALLBACK[r.documentType] ?? r.documentType,
        )
      : // `''` is what `InvoiceService` writes on the pending row, and the failure
        // patch never backfills it — so a raw render left the merged cell's only
        // text blank on exactly the rows a triage filter selects.
        t('invoice.documentType.unknown', DOCUMENT_TYPE_UNKNOWN_LABEL);

  const renderDocumentCell = (r: InvoiceRecord): ReactElement => {
    const label = documentTypeLabel(r);
    return (
      <span className="invoice-document-cell">
        {r.providerInvoiceNumber ? (
          // `isSafeHttpUrl`, not `r.pdfUrl` truthiness: `InvoicePdfLink` renders an
          // anchor only for an http(s) URL, and nothing validates the scheme
          // server-side — so branching on truthiness left a relative or garbage
          // URL rendering inert plain text, which is the very state this branch
          // exists to remove. KSeF and inFakt hard-null `pdfUrl` outright, so the
          // Copy path is the common one, not the exception.
          r.pdfUrl !== null && isSafeHttpUrl(r.pdfUrl) ? (
            <InvoicePdfLink invoiceNumber={r.providerInvoiceNumber} pdfUrl={r.pdfUrl} />
          ) : (
            <CopyableId
              id={r.providerInvoiceNumber}
              copyLabel={t('invoice.copyNumber', `Copy document number ${r.providerInvoiceNumber}`)}
            />
          )
        ) : (
          // Not a receipt-only branch: every not-yet-issued record lands here, so
          // line 2 has to carry a real word rather than an empty string.
          <EmptyValue />
        )}
        <span className="text-muted invoice-document-cell__type" title={label}>
          {label}
        </span>
        {/* The Connection column is `hideBelow: 1024`, so below that width the
            issuing provider would vanish. It folds here instead (#2094): what a
            document is and who issued it are the same sentence, and this column
            is deliberately always visible for exactly that reason. No adornment,
            matching the desktop cell on this page. `display: none` above the
            breakpoint keeps exactly one rendering exposed at any width. */}
        <ConnectionFold
          connectionId={r.connectionId}
          connection={connectionsById.get(r.connectionId) ?? null}
          loading={connectionsQuery.isLoading}
        />
      </span>
    );
  };

  // `DataTableCard` wraps `title` + `subtitle` in the row's `<Link>` whenever
  // `rowHref` is set (`data-table.tsx`), and this page always sets it. So the CARD
  // gets text-only renderers: putting the desktop cells there nested an `<a>` and
  // two `<button>`s inside an anchor — invalid, and worse, the clicks bubbled to
  // the card link, so the PDF number navigated to the invoice instead of opening
  // the PDF and both Copy buttons copied AND navigated away. #2089 never hit this
  // because Shipments uses `expandable` and passes no `rowHref`.
  //
  // Same facts, same single-sourced label — just no affordances, which the card
  // does not need: the whole card already navigates to the document.
  const renderDocumentCardTitle = (r: InvoiceRecord): ReactElement => (
    <span className="invoice-document-cell">
      {r.providerInvoiceNumber ? (
        <span className="mono-text">{r.providerInvoiceNumber}</span>
      ) : (
        <EmptyValue />
      )}
      <span className="text-muted invoice-document-cell__type">{documentTypeLabel(r)}</span>
    </span>
  );

  const renderOrderCardSubtitle = (r: InvoiceRecord): string => {
    const number = r.orderSummary?.orderNumber?.trim();
    // `formatOrderRef` / `shortenId`, never a raw id: the desktop cell shortens
    // both halves, and Allegro's `orderNumber` IS a 36-character `checkoutFormId`
    // that `buildOrderSummary` hands this page raw.
    const identity = number ? formatOrderRef(number) : shortenId(r.orderId);
    const item = r.orderSummary?.firstItemName?.trim();
    return item ? `${identity} · ${item}` : identity;
  };

  const renderOrderCell = (r: InvoiceRecord): ReactElement => (
    <OrderIdentityCell
      orderId={r.orderId}
      orderNumber={r.orderSummary?.orderNumber}
      firstItemName={r.orderSummary?.firstItemName}
      firstItemImageUrl={r.orderSummary?.firstItemImageUrl}
      itemCount={r.orderSummary?.itemCount}
    />
  );

  // Batch retry state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [retryDialogOpen, setRetryDialogOpen] = useState(false);
  const [retryBanner, setRetryBanner] = useState<{ retried: number; skipped: number } | null>(null);
  const retryMutation = useRetryInvoicesMutation();

  // Bulk-issue state (#1355) — a second batch action reusing the same selection
  // + BulkActionBar. Issues invoices for the selected rows' orders; idempotent
  // per (connection, order) server-side.
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [issueBanner, setIssueBanner] = useState<{
    issued: number;
    skipped: number;
    failed: number;
  } | null>(null);
  const bulkIssueMutation = useBulkIssueInvoicesMutation();

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

  // Bulk-issue fans out one call per invoicing connection: the endpoint takes a
  // single connectionId + orderIds[], and the selection can span connections. We
  // derive (orderId, connectionId) from the loaded rows intersected with the
  // selection (a re-submit is idempotent server-side, so an order already issued
  // just comes back `skipped`). Selection beyond the current page is not resolved
  // here — a deferred follow-up if bulk issue needs to cross pages.
  async function handleIssueConfirm(): Promise<void> {
    const rows = query.data?.items ?? [];
    const selectedRows = rows.filter((r) => selected.has(r.id));
    const orderIdsByConnection = new Map<string, Set<string>>();
    for (const row of selectedRows) {
      const set = orderIdsByConnection.get(row.connectionId) ?? new Set<string>();
      set.add(row.orderId);
      orderIdsByConnection.set(row.connectionId, set);
    }

    let issued = 0;
    let skipped = 0;
    let failed = 0;
    try {
      for (const [conn, orderIdSet] of orderIdsByConnection) {
        const result = await bulkIssueMutation.mutateAsync({
          connectionId: conn,
          orderIds: Array.from(orderIdSet),
        });
        issued += result.issued;
        skipped += result.skipped;
        failed += result.failed;
      }
      setIssueBanner({ issued, skipped, failed });
      setSelected(new Set());
      setIssueDialogOpen(false);
    } catch {
      setIssueDialogOpen(false);
    }
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
      // #2538 - OrderIdentityCell stacks the order number over a meta line.
      lines: 2,
      header: t('invoice.column.orderId', 'Order'),
      // Was the raw 41-character `orderId` in a `mono-text` span: no truncation,
      // no Copy, no link. `orderSummary` has been on this response since #1995 /
      // PR #2012 and was typed-but-unconsumed until now (#2090).
      cell: renderOrderCell,
      accessor: (r) => r.orderSummary?.orderNumber ?? r.orderId,
    },
    {
      // `invoiceNumber` and `documentType` were two columns answering one
      // question — *what document is this?* — in a nine-column budget (#2090).
      // Merged: the number over the type, the number still a working PDF link.
      //
      // Deliberately NOT `hideBelow: 768` (which `documentType` carried): the
      // merged column is the host for #2094's tablet fold of the Connection
      // cell, so it cannot be the thing that disappears at that width.
      id: 'documentType',
      header: t('invoice.column.documentType', 'Document type'),
      cell: renderDocumentCell,
      accessor: (r) => r.documentType,
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
      header: t('invoice.column.clearanceRef', 'Clearance ref.'),
      cell: (r) =>
        r.clearanceReference ? (
          <span className="mono-text" title={r.clearanceReference}>
            {r.clearanceReference}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
      accessor: (r) => r.clearanceReference ?? '',
      hideBelow: 1024,
    },
    {
      id: 'connection',
      header: t('invoice.column.connection', 'Connection'),
      // The id used to live in a `title` attribute — invisible, unselectable and
      // unreachable on touch. No adornment: an invoice's connection IS its
      // issuing provider and the column header already says so (#2090).
      cell: (r) => (
        <ConnectionCell
          connectionId={r.connectionId}
          connection={connectionsById.get(r.connectionId) ?? null}
          loading={connectionsQuery.isLoading}
        />
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
      {retryMutation.error ? (
        <Alert tone="error" className="invoice-list__retry-error">
          {t('invoice.bulk.retryError', 'Batch retry failed:')} {retryMutation.error.message}
          <Button
            tone="secondary"
            className="button--sm"
            style={{ marginLeft: 'var(--space-2)' }}
            onClick={() => retryMutation.reset()}
          >
            {t('invoice.bulk.dismiss', 'Dismiss')}
          </Button>
        </Alert>
      ) : null}

      {bulkIssueMutation.error ? (
        <Alert tone="error" className="invoice-list__issue-error">
          {t('invoice.bulk.issueError', 'Bulk issue failed:')} {bulkIssueMutation.error.message}
          <Button
            tone="secondary"
            className="button--sm"
            style={{ marginLeft: 'var(--space-2)' }}
            onClick={() => bulkIssueMutation.reset()}
          >
            {t('invoice.bulk.dismiss', 'Dismiss')}
          </Button>
        </Alert>
      ) : null}

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
            style={{ marginLeft: 'var(--space-2)' }}
            onClick={() => setRetryBanner(null)}
          >
            {t('invoice.bulk.dismiss', 'Dismiss')}
          </Button>
        </Alert>
      ) : null}

      {issueBanner ? (
        <Alert tone="success" className="invoice-list__issue-banner">
          {t('invoice.bulk.issueResult', 'Bulk issue complete.')}{' '}
          {issueBanner.issued > 0
            ? t('invoice.bulk.issued', `${issueBanner.issued} issued.`)
            : null}{' '}
          {issueBanner.skipped > 0
            ? t('invoice.bulk.issueSkipped', `${issueBanner.skipped} skipped (already issued or in progress).`)
            : null}{' '}
          {issueBanner.failed > 0
            ? t('invoice.bulk.issueFailed', `${issueBanner.failed} failed.`)
            : null}
          <Button
            tone="secondary"
            className="button--sm"
            style={{ marginLeft: 'var(--space-2)' }}
            onClick={() => setIssueBanner(null)}
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
              {/* Reuse the badge's label map (#1585 F7) so the filter never falls
                  back to the raw hyphenated slug next to nicely-labelled badges. */}
              {t(`invoice.regulatory.${s}`, REGULATORY_STATUS_LABEL_FALLBACK[s])}
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
        <DataTableSkeleton columns={columns} label="Loading invoices…" />
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
            // Scopes the leading-checkbox alignment for the ~60px identity row —
            // `DataTable` lands `className` on its container, so the rule is a
            // descendant selector on this page's table only (see `index.css`).
            className="invoices-table"
            caption={t('invoice.list.caption', 'Invoices')}
            columns={columns}
            rows={query.data?.items ?? []}
            rowKey={(r) => r.id}
            rowHref={(r) => `/invoices/${r.id}`}
            cardView={{
              // Text-only, deliberately — see `renderDocumentCardTitle`. Same
              // facts as the desktop columns, no nested interactive content.
              title: renderDocumentCardTitle,
              subtitle: renderOrderCardSubtitle,
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
              tone="secondary"
              className="button--sm"
              disabled={bulkIssueMutation.isPending}
              onClick={() => setIssueDialogOpen(true)}
            >
              {t('invoice.bulk.issue', 'Issue invoices')}
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

      <ConfirmDialog
        open={issueDialogOpen}
        onOpenChange={setIssueDialogOpen}
        title={t('invoice.bulk.issueConfirmTitle', 'Issue invoices')}
        description={t(
          'invoice.bulk.issueConfirmBody',
          `Issue invoices for the ${selected.size} selected order(s)? Orders that already have ` +
            `an issued invoice (or one in progress) are skipped; issuance is idempotent per order.`,
        )}
        confirmLabel={t('invoice.bulk.issueConfirmAction', 'Issue')}
        cancelLabel={t('invoice.bulk.issueCancel', 'Cancel')}
        tone="default"
        isConfirming={bulkIssueMutation.isPending}
        onConfirm={() => void handleIssueConfirm()}
      />
    </PageLayout>
  );
}
