/**
 * Sales Documents List Page (#3307)
 *
 * The merged, kind-aware replacement for `/invoices` — every invoice AND
 * fiscal-receipt record, newest-first, across connections. Backs
 * `GET /sales-documents` (#3306), which is keyset-paginated (no `total`, no
 * `offset`): pagination here is a "Load more" cursor stack rather than the
 * page-number pagination `InvoicesListPage` uses, because a merged financial
 * list must not silently skip or duplicate a row when a new document lands
 * mid-walk (see the backend's own docblock).
 *
 * Deliberately scoped down from the full mockup for this first slice — no
 * KPI strip, no bulk actions (those stay kind-specific and live on the
 * existing per-kind detail flows), no aggregate summary read. Filters,
 * columns and the reinstated per-row popover (`SalesDocumentListCell`,
 * `docs/plans/mockups/sales-documents.html`) are the MVP; the rest is a
 * stated follow-up.
 *
 * @module apps/web/src/pages/sales-documents
 */
import { useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { Button } from '../../shared/ui/button';
import { Input } from '../../shared/ui/input';
import { Select } from '../../shared/ui/select';
import { TimeDisplay } from '../../shared/ui/time-display';
import { EmptyValue } from '../../shared/ui/empty-value';
import { DocumentKindGlyph } from '../../shared/ui/document-kind-glyph';
import {
  useSalesDocumentsListQuery,
  SalesDocumentListCell,
  SALES_DOCUMENT_KIND_VALUES,
  type SalesDocumentKind,
  type SalesDocumentListItem,
} from '../../features/sales-documents';
import { ConnectionCell, useConnectionsQuery } from '../../features/connections';
import { OrderIdentityCell } from '../../features/orders';

const PAGE_SIZE = 20;

const TAX_ID_VALUES = ['with', 'without'] as const;
type TaxIdFilter = (typeof TAX_ID_VALUES)[number];

function isSalesDocumentKind(value: string | null): value is SalesDocumentKind {
  return value !== null && (SALES_DOCUMENT_KIND_VALUES as readonly string[]).includes(value);
}

function isTaxIdFilter(value: string | null): value is TaxIdFilter {
  return value !== null && (TAX_ID_VALUES as readonly string[]).includes(value);
}

const KIND_LABEL: Record<string, string> = {
  invoice: 'Invoice',
  'fiscal-receipt': 'Fiscal receipt',
};

export function SalesDocumentsListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();

  const rawKind = searchParams.get('kind');
  const kind = isSalesDocumentKind(rawKind) ? rawKind : undefined;
  const status = searchParams.get('status') ?? undefined;
  const connectionId = searchParams.get('connectionId') ?? undefined;
  const rawTaxId = searchParams.get('taxId');
  const taxId = isTaxIdFilter(rawTaxId) ? rawTaxId : undefined;
  const search = searchParams.get('search') ?? undefined;

  const issuedFrom = searchParams.get('issuedFrom') || undefined;
  const issuedTo = searchParams.get('issuedTo') || undefined;
  const issuedFromIso = issuedFrom ? `${issuedFrom}T00:00:00.000Z` : undefined;
  const issuedToIso = issuedTo ? `${issuedTo}T23:59:59.999Z` : undefined;

  const filters = { kind, status, connectionId, taxId, search, issuedFrom: issuedFromIso, issuedTo: issuedToIso };

  // Cursor stack — index 0 is "no cursor" (first page). Reset whenever a
  // filter changes (setFilter clears it), since a keyset walk is only valid
  // for the filter set it was fetched under.
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const currentCursor = cursorStack[cursorStack.length - 1];

  const query = useSalesDocumentsListQuery(filters, { limit: PAGE_SIZE, cursor: currentCursor });

  const connectionsQuery = useConnectionsQuery();
  const connections = connectionsQuery.data ?? [];
  const connectionsById = new Map(connections.map((c) => [c.id, { name: c.name, status: c.status }]));
  const connectionNames = new Map(connections.map((c) => [c.id, c.name]));

  function setFilter(key: string, value: string): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
    setCursorStack([]);
  }

  function goNext(): void {
    if (query.data?.nextCursor) {
      setCursorStack((prev) => [...prev, query.data!.nextCursor as string]);
    }
  }

  function goPrev(): void {
    setCursorStack((prev) => prev.slice(0, -1));
  }

  const renderAmount = (item: SalesDocumentListItem): ReactElement => {
    if (!item.amount) return <EmptyValue />;
    return (
      <span className="mono-text tabular">
        {item.amount.value.toFixed(2)} {item.amount.currency}
      </span>
    );
  };

  const columns: DataTableColumn<SalesDocumentListItem>[] = [
    {
      id: 'orderId',
      lines: 2,
      header: 'Order',
      cell: (item) => <OrderIdentityCell orderId={item.orderId} />,
      accessor: (item) => item.orderId,
    },
    {
      id: 'kind',
      header: 'Kind',
      cell: (item) => (
        <span className="invoice-document-cell">
          <DocumentKindGlyph kind={item.document.kind} />
          <span>{KIND_LABEL[item.document.kind] ?? item.document.kind}</span>
        </span>
      ),
      accessor: (item) => item.document.kind,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (item) => (
        <SalesDocumentListCell
          orderId={item.orderId}
          document={item.document}
          otherRecordCount={item.otherRecordCount}
          connectionNames={connectionNames}
        />
      ),
    },
    {
      id: 'amount',
      header: 'Amount',
      cell: renderAmount,
      accessor: (item) => item.amount?.value ?? 0,
    },
    {
      id: 'connection',
      header: 'Connection',
      cell: (item) => (
        <ConnectionCell
          connectionId={item.connectionId}
          connection={connectionsById.get(item.connectionId) ?? null}
          loading={connectionsQuery.isLoading}
        />
      ),
      hideBelow: 1024,
    },
    {
      id: 'createdAt',
      header: 'Created',
      cell: (item) => <TimeDisplay iso={item.document.identity.createdAt} format="date" />,
      accessor: (item) => item.document.identity.createdAt,
    },
  ];

  const hasFilters = Boolean(kind || status || connectionId || taxId || search || issuedFrom || issuedTo);
  const items = query.data?.items ?? [];

  return (
    <PageLayout
      eyebrow="Operations"
      title="Sales documents"
      description="Every issued invoice and registered fiscal receipt across connections, in one place."
    >
      <div className="toolbar">
        <Select
          aria-label="Filter by kind"
          value={kind ?? ''}
          onChange={(e) => setFilter('kind', e.target.value)}
        >
          <option value="">All kinds</option>
          {SALES_DOCUMENT_KIND_VALUES.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k] ?? k}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Filter by connection"
          value={connectionId ?? ''}
          onChange={(e) => setFilter('connectionId', e.target.value)}
        >
          <option value="">All connections</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Filter by buyer tax ID"
          value={taxId ?? ''}
          onChange={(e) => setFilter('taxId', e.target.value)}
        >
          <option value="">All buyer tax IDs</option>
          <option value="with">With tax ID</option>
          <option value="without">Without tax ID</option>
        </Select>

        <Input
          type="search"
          placeholder="Order id, document number…"
          aria-label="Search"
          value={search ?? ''}
          onChange={(e) => setFilter('search', e.target.value)}
        />

        <Input
          type="date"
          aria-label="Issued from"
          value={issuedFrom ?? ''}
          onChange={(e) => setFilter('issuedFrom', e.target.value)}
        />
        <Input
          type="date"
          aria-label="Issued to"
          value={issuedTo ?? ''}
          onChange={(e) => setFilter('issuedTo', e.target.value)}
        />
      </div>

      {query.isLoading ? (
        <DataTableSkeleton columns={columns} label="Loading sales documents…" />
      ) : query.error ? (
        <ErrorState
          title="Unable to load sales documents"
          message={query.error.message}
          action={<Button onClick={() => void query.refetch()}>Retry</Button>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          liveRegion="off"
          title="No sales documents found"
          message={
            hasFilters
              ? 'No documents match the current filters. Try clearing some filters.'
              : 'No invoices or fiscal receipts have been issued yet.'
          }
        />
      ) : (
        <>
          <DataTable
            caption="Sales documents"
            columns={columns}
            rows={[...items]}
            rowKey={(item) => `${item.document.kind}:${item.document.identity.recordId}`}
          />

          <div className="pagination">
            <span className="text-muted">Showing {items.length}</span>
            <div className="pagination__actions">
              <Button disabled={cursorStack.length === 0} onClick={goPrev}>
                Previous
              </Button>
              <Button disabled={!query.data?.nextCursor} onClick={goNext}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </PageLayout>
  );
}
