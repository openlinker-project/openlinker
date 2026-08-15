/**
 * Customers List Page
 *
 * #2093 (epic #2086) — the list leads with a person instead of an identifier:
 *   - `Customer` is now the FIRST column: first + last name, falling back to the
 *     email hash on a deployment running `OL_STORE_PII=false`, where the API
 *     returns no name at all.
 *   - The standalone `Email Hash` column is gone — deliberately. The hash is the
 *     name's fallback here and stays in full on the customer detail page; a
 *     whole column for it was only ever meaningful on the PII-disabled
 *     deployment.
 *   - `Customer ID` renders a `CopyableId` with the SHORTENED id (Copy still
 *     writes the full one).
 *   - `Last Source` printed a bare connection UUID because the page held no
 *     connections read at all; it is now the shared `ConnectionCell` (#2027) fed
 *     from ONE batched `useConnectionsQuery()` — never one request per row.
 *     No adornment: the column header already says what the connection is, and
 *     the mockup's frame 03 specifies Customers as the no-adornment caller.
 *
 * The page adds no Orders column: it has none today and the order count lives on
 * the customer detail page's tab heading (#1996, frame 07).
 *
 * @module apps/web/src/pages/customers
 */
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { useTableSort } from '../../shared/ui/use-table-sort';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { Button } from '../../shared/ui/button';
import { CopyableId } from '../../shared/ui/copyable-id';
import { EmptyValue } from '../../shared/ui/empty-value';
import { shortenId } from '../../shared/ui/entity-label';
import { Input } from '../../shared/ui/input';
import { TimeDisplay } from '../../shared/ui/time-display';
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value';
import { ConnectionCell, useConnectionsQuery } from '../../features/connections';
import type { ConnectionCellFacts } from '../../features/connections';
import { useCustomersQuery } from '../../features/customers/hooks/use-customers-query';
import type { CustomerFilters, CustomerProjection } from '../../features/customers/api/customers.types';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

interface CustomerIdentity {
  label: string;
  /** True when the deployment stores no PII and the label is the email hash. */
  isHashFallback: boolean;
}

/**
 * Single-sourced customer identity. The desktop column and the mobile card both
 * read it, so the two surfaces cannot drift back to headlining different facts —
 * the card used to headline the raw internal id this issue exists to remove.
 */
function customerIdentity(c: CustomerProjection): CustomerIdentity {
  const name = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  return name ? { label: name, isHashFallback: false } : { label: c.emailHash, isHashFallback: true };
}

export function CustomersListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const { sort, setSort } = useTableSort([{ id: 'lastSeenAt', desc: true }]);

  const urlSearch = searchParams.get('search') ?? '';
  const urlConnectionId = searchParams.get('lastSourceConnectionId') ?? '';
  const offset = Number(searchParams.get('offset') ?? '0');

  const [searchInput, setSearchInput] = useState(urlSearch);
  const [connectionIdInput, setConnectionIdInput] = useState(urlConnectionId);
  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);
  const debouncedConnectionId = useDebouncedValue(connectionIdInput, SEARCH_DEBOUNCE_MS);

  const filters: CustomerFilters = {
    search: debouncedSearch || undefined,
    lastSourceConnectionId: debouncedConnectionId || undefined,
  };
  const pagination = { limit: PAGE_SIZE, offset };

  const query = useCustomersQuery(filters, pagination);

  // ONE batched read for the whole page (#1996): the `Last connection source`
  // column resolves every row out of this map. Deliberately unfiltered — a
  // `status: 'active'` filter would drop a disabled or errored connection from
  // the map, and the cell would then read "Unknown" for a connection that very
  // much exists, hiding the status note that is the whole point of line 2.
  const connectionsQuery = useConnectionsQuery();
  // `{ name, status }` — that is `ConnectionCellFacts`; supplying only the name
  // leaves the cell's status note unresolved on exactly the batched path the AC
  // demands (#2027). A Map so a miss coalesces to `null` below: `undefined`
  // reads as "resolve it yourself" and silently reinstates a per-row fetch.
  const connectionsById = useMemo(() => {
    const map = new Map<string, ConnectionCellFacts>();
    (connectionsQuery.data ?? []).forEach((c) => map.set(c.id, { name: c.name, status: c.status }));
    return map;
  }, [connectionsQuery.data]);

  const columns: DataTableColumn<CustomerProjection>[] = useMemo(
    () => [
      {
        id: 'customer',
        header: 'Customer',
        cell: (c): ReactNode => {
          const { label, isHashFallback } = customerIdentity(c);
          // A hash alone in a column headed "Customer" reads as a bug rather
          // than as a deployment setting, so the fallback says why it is there.
          return isHashFallback ? (
            <span className="customer-identity">
              <span className="mono-text">{label}</span>
              <span className="text-muted customer-identity__note">Name not stored</span>
            </span>
          ) : (
            <span>{label}</span>
          );
        },
        accessor: (c) => customerIdentity(c).label,
        sortable: true,
      },
      {
        id: 'internalCustomerId',
        header: 'Customer ID',
        cell: (c): ReactNode => {
          const { label, isHashFallback } = customerIdentity(c);
          // Named after the person where there is one; a hash spelled out into a
          // screen reader is worse than the generic phrase (the same rule
          // `ConnectionCell` applies to an unresolved connection).
          const subject = isHashFallback ? 'customer ID' : `customer ID for ${label}`;
          return (
            <CopyableId
              id={c.internalCustomerId}
              label={shortenId(c.internalCustomerId)}
              copyLabel={`Copy ${subject}`}
              copiedLabel={`Copied ${subject}`}
            />
          );
        },
      },
      {
        id: 'lastSourceConnectionId',
        header: 'Last connection source',
        cell: (c): ReactNode =>
          c.lastSourceConnectionId ? (
            <ConnectionCell
              connectionId={c.lastSourceConnectionId}
              // `.get()` misses with `undefined`, which the cell reads as
              // "resolve it yourself"; `?? null` keeps it on the batched path.
              connection={connectionsById.get(c.lastSourceConnectionId) ?? null}
              // Without this every row reads "Unknown" until the batched query
              // settles — indistinguishable from a genuinely deleted connection.
              loading={connectionsQuery.isLoading}
            />
          ) : (
            <EmptyValue />
          ),
        // Unchanged at 768 (#1996): the column survives at tablet width, so this
        // page needs no tablet fold and is out of #2094's scope.
        hideBelow: 768,
      },
      {
        id: 'lastSeenAt',
        header: 'Last seen',
        cell: (c): ReactNode => <TimeDisplay iso={c.lastSeenAt} format="date" />,
        accessor: (c) => c.lastSeenAt,
        sortable: true,
      },
    ],
    [connectionsById, connectionsQuery.isLoading],
  );

  function handleFilterChange(key: string, value: string): void {
    if (key === 'search') setSearchInput(value);
    if (key === 'lastSourceConnectionId') setConnectionIdInput(value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      next.delete('offset');
      return next;
    });
  }

  function setOffset(next: number): void {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === 0) {
        p.delete('offset');
      } else {
        p.set('offset', String(next));
      }
      return p;
    });
  }

  function clearFilters(): void {
    setSearchInput('');
    setConnectionIdInput('');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('search');
      next.delete('lastSourceConnectionId');
      next.delete('offset');
      return next;
    });
  }

  const filtersActive = Boolean(debouncedSearch || debouncedConnectionId);
  const total = query.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <PageLayout
      eyebrow="Operations"
      title="Customers"
      description="Customer identity projections — browse resolved identities and address history."
    >
      <div className="toolbar toolbar--compact">
        <Input
          aria-label="Search customers"
          placeholder="Search by email or name…"
          value={searchInput}
          onChange={(e) => { handleFilterChange('search', e.target.value); }}
        />
        <Input
          aria-label="Filter by source connection ID"
          placeholder="Source connection ID…"
          value={connectionIdInput}
          onChange={(e) => { handleFilterChange('lastSourceConnectionId', e.target.value); }}
        />
      </div>

      {query.isLoading ? (
        <DataTableSkeleton columns={columns} />
      ) : query.error ? (
        <ErrorState
          title="Unable to load customers"
          message={query.error.message}
          action={
            <Button onClick={() => { void query.refetch(); }}>Retry</Button>
          }
        />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          liveRegion="off"
          title="No customers found"
          message={
            filtersActive
              ? 'No customer projections match the current filters.'
              : 'No customer projections have been recorded yet.'
          }
          action={
            filtersActive ? (
              <Button onClick={clearFilters}>Clear filters</Button>
            ) : (
              <Link className="button button--primary" to="/orders">
                Browse orders
              </Link>
            )
          }
        />
      ) : (
        <>
          <DataTable
            caption="Customer projections"
            columns={columns}
            rows={query.data?.items ?? []}
            rowKey={(c) => c.internalCustomerId}
            rowHref={(c) => c.internalCustomerId}
            // The `Customer` cell is the row link, and on a PII-disabled row it
            // is a two-line stack. An inline anchor sizes its :focus-visible ring
            // from its own line-box metrics, which paints a band across the row's
            // middle around a composite (see the style guide's listings
            // carve-out); an atomic inline-level box makes it one fragment.
            rowLinkDisplay="block"
            sort={sort}
            onSortChange={setSort}
            cardView={{
              // TEXT-ONLY, and it has to be: `DataTableCard` wraps `title` and
              // `subtitle` in the row's own `<Link>` whenever `rowHref` is set,
              // which this table always does. Hosting the desktop renderers here
              // would nest the Copy button and the connection link inside an
              // anchor — invalid, and the clicks would bubble to the card link
              // (#2090 shipped exactly that bug). Same facts, same
              // `customerIdentity` helper, no affordances: the card already
              // navigates to the customer.
              title: (c) => customerIdentity(c).label,
              subtitle: (c) => (
                <span className="mono-text">{shortenId(c.internalCustomerId)}</span>
              ),
              meta: (c) => <TimeDisplay iso={c.lastSeenAt} format="date" />,
            }}
          />

          <div className="pagination">
            <span className="text-muted">
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <div className="pagination__actions">
              <Button disabled={!hasPrev} onClick={() => { setOffset(offset - PAGE_SIZE); }}>
                Previous
              </Button>
              <Button disabled={!hasNext} onClick={() => { setOffset(offset + PAGE_SIZE); }}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </PageLayout>
  );
}
