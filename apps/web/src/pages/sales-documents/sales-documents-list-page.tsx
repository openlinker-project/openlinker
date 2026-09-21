/**
 * Sales Documents List Page (#3307)
 *
 * The merged, kind-aware replacement for the `/invoices` LIST — every invoice
 * AND fiscal-receipt record, newest-first, across connections. Backs
 * `GET /sales-documents` (#3306), which is keyset-paginated (no `total`, no
 * `offset`): pagination here is a Previous/Next cursor STACK, not a
 * "Load more" accumulator (this page replaces its rows on every step, it
 * never appends to them) and not the page-number pagination
 * `InvoicesListPage` uses, because a merged financial list must not silently
 * skip or duplicate a row when a new document lands mid-walk (see the
 * backend's own docblock).
 *
 * Deliberately scoped down from the full mockup for this first slice — no
 * KPI strip, no aggregate summary read. Filters, columns and the reinstated
 * per-row popover (`SalesDocumentListCell`, `docs/plans/mockups/sales-documents.html`)
 * are the MVP; the rest is a stated follow-up.
 *
 * Bulk actions are NOT reproduced here (#3309 review, BLOCKING 1):
 * `InvoicesListPage` — still mounted at `/invoices` — carries the ONLY batch
 * retry and bulk-issue (#1355) flows in the product, and bulk issue is the
 * documented primary remediation path for a `salesDocumentBlocked` order
 * (`docs/architecture-overview.md` §14 Invoicing: excluding a blocked order
 * from bulk issuance "would break the primary remediation path for the
 * state this surfacing exists to reveal"). Retiring that page in the same
 * change that ships this one would have removed the remedy while keeping
 * the alarm, so `/invoices` stays live and this page links out to it.
 *
 * @module apps/web/src/pages/sales-documents
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
import { formatAmount } from '../../shared/format/format-amount';
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value';
import {
  useSalesDocumentsListQuery,
  SalesDocumentListCell,
  SALES_DOCUMENT_KIND_VALUES,
  type SalesDocumentKind,
  type SalesDocumentListItem,
} from '../../features/sales-documents';
import { ConnectionCell, useConnectionsQuery } from '../../features/connections';
import { OrderIdentityCell } from '../../features/orders';
import { InvoiceStatusValues } from '../../features/invoicing';
import { FiscalRegistrationStatusValues } from '../../features/fiscalization';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

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

// Status is matched against whichever vocabulary `kind` selects (backend
// DTO docblock: "with `kind` unset it must accept EITHER vocabulary"). The
// options offered here are therefore kind-scoped, so an operator is never
// shown a status word that cannot match a single row on the current
// filter — with no `kind` selected, both vocabularies are offered, since
// the backend accepts either.
const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  issuing: 'Issuing',
  issued: 'Issued',
  failed: 'Failed',
  registering: 'Registering',
  registered: 'Registered',
};

function statusOptionsForKind(kind: SalesDocumentKind | undefined): readonly string[] {
  if (kind === 'invoice') return InvoiceStatusValues;
  if (kind === 'fiscal-receipt') return FiscalRegistrationStatusValues;
  return [...new Set([...InvoiceStatusValues, ...FiscalRegistrationStatusValues])];
}

export function SalesDocumentsListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();

  const rawKind = searchParams.get('kind');
  const kind = isSalesDocumentKind(rawKind) ? rawKind : undefined;
  const status = searchParams.get('status') ?? undefined;
  const connectionId = searchParams.get('connectionId') ?? undefined;
  const rawTaxId = searchParams.get('taxId');
  const taxId = isTaxIdFilter(rawTaxId) ? rawTaxId : undefined;

  const issuedFrom = searchParams.get('issuedFrom') || undefined;
  const issuedTo = searchParams.get('issuedTo') || undefined;
  const issuedFromIso = issuedFrom ? `${issuedFrom}T00:00:00.000Z` : undefined;
  const issuedToIso = issuedTo ? `${issuedTo}T23:59:59.999Z` : undefined;

  // Search is debounced BEFORE it ever reaches the query or the URL (#3309
  // review, IMPORTANT): typing "order id, document number..." fires neither a
  // request nor a history entry per keystroke. `searchInput` is the input's
  // live value; `search` (what the query and `hasFilters` read) only catches
  // up once typing pauses for SEARCH_DEBOUNCE_MS.
  const [searchInput, setSearchInput] = useState(searchParams.get('search') ?? '');
  const search = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS) || undefined;

  const filters = { kind, status, connectionId, taxId, search, issuedFrom: issuedFromIso, issuedTo: issuedToIso };

  // Cursor stack — index 0 is "no cursor" (first page). Reset whenever a
  // filter changes (setFilter clears it, or the search-debounce effect
  // below), since a keyset walk is only valid for the filter set it was
  // fetched under.
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

  // `status` is scoped to the vocabulary `kind` selects (see `statusOptionsForKind`),
  // so narrowing `kind` can leave a previously-picked `status` unmatchable by
  // either vocabulary. Clear it in the same update rather than leaving a stale
  // value that would silently return zero rows with no visible cause.
  function setKindFilter(value: string): void {
    const nextKind = isSalesDocumentKind(value) ? value : undefined;
    const validStatuses = statusOptionsForKind(nextKind);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set('kind', value);
      else next.delete('kind');
      const currentStatus = next.get('status');
      if (currentStatus && !validStatuses.includes(currentStatus)) next.delete('status');
      return next;
    });
    setCursorStack([]);
  }

  // Syncs the debounced search value to the URL (shareable/bookmarkable,
  // like every other filter here) and resets the cursor stack for it — once
  // per debounce settle, not once per keystroke. `replace: true` so a typed
  // search term never spams Back with one entry per pause.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (search) next.set('search', search);
        else next.delete('search');
        return next;
      },
      { replace: true },
    );
    setCursorStack([]);
    // Deliberately depends only on `search` (the debounced value) — `setSearchParams`
    // is a stable dispatcher and re-running this on its identity would defeat the
    // whole point of debouncing.
  }, [search]);

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
    // `formatAmount` (#3309 review, SUGGESTION), not a hardcoded
    // `.toFixed(2)`: a bare two-decimal render is wrong for a zero-decimal
    // currency (JPY) and short a digit for a three-decimal one (KWD).
    return <span className="mono-text tabular">{formatAmount(item.amount.value, item.amount.currency)}</span>;
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
      actions={
        // Bulk actions (batch retry, bulk issue) live only on the per-kind
        // `/invoices` list today — see the file header — so this stays
        // reachable rather than silently dropped.
        <Link className="button button--secondary" to="/invoices">
          Manage invoices
        </Link>
      }
    >
      <div className="toolbar">
        <Select
          aria-label="Filter by kind"
          value={kind ?? ''}
          onChange={(e) => setKindFilter(e.target.value)}
        >
          <option value="">All kinds</option>
          {SALES_DOCUMENT_KIND_VALUES.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k] ?? k}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Filter by status"
          value={status ?? ''}
          onChange={(e) => setFilter('status', e.target.value)}
        >
          <option value="">All statuses</option>
          {statusOptionsForKind(kind).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s] ?? s}
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
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
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
      ) : items.length === 0 && cursorStack.length > 0 ? (
        // Reached only by clicking Next off a loaded table (#3309 review,
        // BLOCKING 2) — the backend's keyset walk can legitimately answer
        // an empty page carrying no `nextCursor` (the walk's true last
        // page), and NOT because the operator has no documents. Rendering
        // the never-issued copy here would be a false claim about their
        // data on the exact screen where they were just reading it.
        // `liveRegion` stays at the default "polite": this is a transition
        // from a prior loaded table, not an initial-load landing.
        <EmptyState
          title="No more documents"
          message="You've reached the end of this list."
          action={<Button onClick={goPrev}>Back</Button>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          // "off" only for the true virgin landing (no filters, first page —
          // nothing to transition from); every other empty arm here is
          // reached from a prior loaded table and keeps the "polite" default.
          liveRegion={hasFilters ? undefined : 'off'}
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
