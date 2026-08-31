/**
 * Customers List Page
 *
 * #2093 (epic #2086) — the list leads with a person instead of an identifier:
 *   - `Customer` is now the FIRST column: first + last name, falling back to the
 *     email hash when the projection carries no name.
 *
 *     A nameless row is NOT evidence of `OL_STORE_PII=false`. Identity
 *     resolution creates every projection with `firstName`/`lastName` null
 *     (`customer-identity-resolver.service.ts`), and the names are backfilled
 *     later, only if an order for that customer carries a shipping or billing
 *     name (`order-customer-projection-updater.service.ts`). So a nameless row
 *     is routine on a fully PII-enabled deployment too, and the fallback's
 *     qualifier states the row-level fact ("No name recorded") rather than
 *     asserting a deployment setting the row cannot observe.
 *   - The standalone `Email Hash` column is gone — deliberately. The hash is the
 *     name's fallback here and stays in full on the customer detail page.
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

/**
 * Row-level fact, never a deployment claim: a projection is born nameless and is
 * only backfilled once an order carries a shipping/billing name, so this is the
 * common case on a fully PII-enabled deployment (see the file header).
 */
const NAMELESS_LABEL = 'No name recorded';

/**
 * Sort key for a nameless row. Sorting by the rendered label is right, but the
 * label is then a hash, which scatters nameless rows randomly through the name
 * ordering. A sentinel above every ordinary character clusters them at one end
 * deterministically (last ascending, first descending).
 */
const NAMELESS_SORT_KEY = '\uFFFF';

interface CustomerIdentity {
  label: string;
  /** True when the projection carries no name and the label is the email hash. */
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
        // `name` unchanged since before #2093: `useTableSort` round-trips the
        // column id through `?sort=`, and an id nothing derives from the header
        // is pure churn — a bookmarked `?sort=name:asc` would resolve to no
        // column and sort by NOTHING, not by the default.
        id: 'name',
        header: 'Customer',
        cell: (c): ReactNode => {
          const { label, isHashFallback } = customerIdentity(c);
          // A hash alone in a column headed "Customer" reads as a bug, so the
          // fallback states the row-level fact that no name was recorded.
          return isHashFallback ? (
            <span className="customer-identity">
              {/* `aria-hidden` + `title`, not `CopyableId`: this cell IS the row
                  link (`DataTable` linkifies the first cell whenever `rowHref`
                  is set), so its text content is the link's accessible name and
                  a 64-character SHA-256 hex would be spelled out character by
                  character — the same reason the Copy button two columns right
                  says the generic "customer ID". A `CopyableId` here would nest
                  a <button> inside that anchor, which `docs/lessons.md` bans.
                  `title` keeps the full hash reachable for a sighted operator:
                  it is the server-side search key (`emailHash ILIKE`, which
                  this page's own search box accepts), the cell truncates it
                  with an ellipsis, and drag-selecting inside the row anchor
                  starts a link drag rather than a text selection. */}
              <span className="mono-text" title={label} aria-hidden="true">
                {label}
              </span>
              {/* Names the link for a screen reader; the visible qualifier below
                  supplies the rest of the accessible name. */}
              <span className="sr-only">Customer, </span>
              <span className="text-muted customer-identity__note">{NAMELESS_LABEL}</span>
            </span>
          ) : (
            <span>{label}</span>
          );
        },
        // Sort by what the column renders — but a nameless row renders a hash,
        // which would scatter those rows through the alphabet at random.
        accessor: (c): string => {
          const { label, isHashFallback } = customerIdentity(c);
          return isHashFallback ? NAMELESS_SORT_KEY : label;
        },
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
        // #2538 - ConnectionCell stacks the connection name over its status (#2093).
        lines: 2,
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
        <DataTableSkeleton columns={columns} label="Loading customers…" />
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
            // `ConnectionCell` made the Source column the tallest thing on the
            // row (~2 lines), so `.data-table td { vertical-align: middle }`
            // would centre the one-line Customer name against it while the
            // connection name sits on line 1. Per the style guide's heuristic,
            // when another column sets the row height you align the whole row.
            className="customers-table"
            columns={columns}
            rows={query.data?.items ?? []}
            rowKey={(c) => c.internalCustomerId}
            rowHref={(c) => c.internalCustomerId}
            // The `Customer` cell is the row link, and on a nameless row it is a
            // two-line stack. An inline anchor sizes its :focus-visible ring
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
              //
              // The nameless row gets its OWN branch rather than reusing the
              // desktop label. `.data-table__card-title` is 13.5px/600 with
              // `word-break: break-word` and no cap, so headlining the label
              // there would print a 64-character hash as a three-line bold hex
              // blob — and it would drop the qualifier the desktop cell exists
              // to supply, restoring exactly the "reads as a bug" state.
              title: (c) => {
                const { label, isHashFallback } = customerIdentity(c);
                return isHashFallback ? NAMELESS_LABEL : label;
              },
              subtitle: (c) => {
                const { label, isHashFallback } = customerIdentity(c);
                return (
                  <>
                    {isHashFallback ? (
                      <>
                        {/* Shortened, and `title`-carried in full: the hash is
                            the only identity a nameless row has, and it is the
                            server-side search key. */}
                        <span className="mono-text" title={label}>
                          {shortenId(label)}
                        </span>
                        <span aria-hidden="true"> · </span>
                      </>
                    ) : null}
                    <span className="mono-text">{shortenId(c.internalCustomerId)}</span>
                  </>
                );
              },
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
