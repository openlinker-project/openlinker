import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { Button } from '../../shared/ui/button';
import { EmptyValue } from '../../shared/ui/empty-value';
import { Input } from '../../shared/ui/input';
import { KeyValueList } from '../../shared/ui/key-value-list';
import { ProductThumbnail } from '../../shared/ui/product-thumbnail';
import { StatusBadge } from '../../shared/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../shared/ui/tabs';
import { TimeDisplay } from '../../shared/ui/time-display';
import { formatAmount } from '../../shared/format/format-amount';
import { formatDateTime } from '../../shared/format/format-date';
import { usePlatforms } from '../../shared/plugins';
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value';
import {
  ConnectionCell,
  useConnectionsQuery,
  type ConnectionCellFacts,
} from '../../features/connections';
import { resolvePlatformLabel } from '../../features/mappings';
import { useListingsQuery } from '../../features/listings/hooks/use-listings-query';
import { OfferProductPickerModal } from '../../features/listings/components/offer-product-picker-modal';
import {
  listingRowAlert,
  listingRowBadges,
  type ListingRowBadge,
} from '../../features/listings/lib/listing-row-state';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { useDemoMode } from '../../features/system';
import type {
  ListingsFilters,
  OfferLifecycle,
  OfferLifecycleCounts,
  OfferMapping,
} from '../../features/listings/api/listings.types';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Lowercase URL-state token for each lifecycle bucket (#2029). Kept distinct
 * from the PascalCase `OfferLifecycle` the API speaks, mirroring the existing
 * `?health=` convention (`orders-list-page.tsx`) of a lowercase URL param.
 */
const LIFECYCLE_TAB_VALUES = ['active', 'inactive', 'draft', 'ended', 'unsynced'] as const;
type LifecycleTab = (typeof LIFECYCLE_TAB_VALUES)[number];

const DEFAULT_TAB: LifecycleTab = 'active';

/** Type-guard for the `tab` URL param, mirroring `isOrderHealth` in `orders-list-page.tsx`. */
function isLifecycleTab(value: string | null): value is LifecycleTab {
  return value !== null && (LIFECYCLE_TAB_VALUES as readonly string[]).includes(value);
}

/**
 * One entry per lifecycle tab: its URL token, the `OfferLifecycle` value it
 * filters by, its label, and its own empty-state copy (#2029) - each bucket
 * means something different (see `offer-lifecycle.types.ts` docblocks), so a
 * single generic "no results" message would under-inform the operator.
 */
interface LifecycleTabDef {
  key: LifecycleTab;
  lifecycle: OfferLifecycle;
  label: string;
  emptyTitle: string;
  emptyMessage: string;
}

const LIFECYCLE_TABS: readonly LifecycleTabDef[] = [
  {
    key: 'active',
    lifecycle: 'Active',
    label: 'Active',
    emptyTitle: 'No active listings',
    emptyMessage: 'Nothing here is currently live on a channel.',
  },
  {
    key: 'inactive',
    lifecycle: 'Inactive',
    label: 'Inactive',
    emptyTitle: 'No inactive listings',
    emptyMessage: 'Nothing here has been rejected by a channel validator.',
  },
  {
    key: 'draft',
    lifecycle: 'Draft',
    label: 'Draft',
    emptyTitle: 'No draft listings',
    // Deliberately NOT "not live yet" - Draft also holds an offer an operator
    // deliberately deactivated weeks ago and will never relist
    // (offer-lifecycle.types.ts), so the copy must not promise a future state.
    emptyMessage: 'Nothing here is currently live, and none of it has been rejected.',
  },
  {
    key: 'ended',
    lifecycle: 'Ended',
    label: 'Ended',
    emptyTitle: 'No ended listings',
    emptyMessage: 'Nothing here has been ended by a channel.',
  },
  {
    key: 'unsynced',
    lifecycle: 'Unsynced',
    label: 'Unsynced',
    emptyTitle: 'No unsynced listings',
    emptyMessage: 'Every mapping here has had its channel status read at least once.',
  },
];

/**
 * Column heading that names whose number the column carries. Price and quantity
 * are what the CHANNEL reports - already the output of the connection's
 * pricing rule and already net of its stock safety buffer - so a bare "Price"
 * would read as OL's own catalog price and a correctly-configured buffer would
 * look like a bug (#1843 / #1844). "Updated" needs the same qualifier for the
 * opposite reason: it is when OL last READ the channel, not when the listing
 * last changed, and a days-old value otherwise reads as a stalled sync.
 */
function ColumnHead({
  label,
  note,
  align,
}: {
  label: string;
  note: string;
  align?: 'right';
}): ReactElement {
  return (
    <span
      className={
        align === 'right' ? 'listings-col-head listings-col-head--right' : 'listings-col-head'
      }
    >
      {label}
      <span className="listings-col-head__note">{note}</span>
    </span>
  );
}

/**
 * `EmptyValue` names itself with `aria-label` on a bare `<span>` - a generic
 * element ARIA prohibits naming, which screen readers commonly drop. The
 * never-read-versus-zero distinction is the whole point of this page's
 * commercial columns, so the wording is also carried visually-hidden.
 */
function AbsentValue({ label }: { label: string }): ReactElement {
  return (
    <>
      <EmptyValue label={label} />
      <span className="sr-only">{label}</span>
    </>
  );
}

function RowBadge({ badge }: { badge: ListingRowBadge }): ReactElement {
  return (
    <StatusBadge
      tone={badge.tone}
      compact
      withDot
      pulse={badge.pulse ?? false}
      solid={badge.solid ?? false}
      className="listing-cell__badge"
    >
      {/* StatusBadge takes no native props, so the hover nuance rides a span -
          and repeats visually-hidden, because a two-word label whose meaning
          lives only in a tooltip is meaning a keyboard user cannot reach. */}
      <span title={badge.title}>{badge.label}</span>
      {badge.title ? <span className="sr-only">. {badge.title}</span> : null}
    </StatusBadge>
  );
}

/**
 * Thumbnail + product name + variant + conditional badges, over a line that
 * groups the three identifiers (external offer id, SKU, EAN). The product name
 * is deliberately NOT its own link: `DataTable` already wraps the first cell in
 * the row link, and an anchor inside an anchor is invalid markup.
 *
 * The `card` shape is frame 05's own reshape for 360px, not the table cell
 * squeezed: name + badges lead, then variant and SKU only. The offer id and EAN
 * move to the card's disclosure - at that width they would take the product
 * name's room, and the name is what the card is about.
 */
function ListingCell({
  row,
  shape = 'row',
}: {
  row: OfferMapping;
  shape?: 'row' | 'card';
}): ReactElement {
  const identity = row.identity ?? null;
  const badges = listingRowBadges(row);
  const alert = listingRowAlert(row);
  const name = identity?.productName ?? null;
  const isCard = shape === 'card';

  return (
    <span className={isCard ? 'listing-cell listing-cell--card' : 'listing-cell'}>
      <ProductThumbnail name={name ?? row.externalId} src={identity?.imageUrl ?? null} size="md" />
      <span className="listing-cell__body">
        <span className="listing-cell__head">
          {name ? (
            <span className="listing-cell__name" title={name}>
              {name}
            </span>
          ) : (
            <span className="listing-cell__name listing-cell__name--missing">
              {identity ? 'Unnamed product' : 'No linked variant'}
            </span>
          )}
          {!isCard && identity?.variantLabel ? (
            <span className="listing-cell__variant">{identity.variantLabel}</span>
          ) : null}
          {badges.map((badge) => (
            <RowBadge key={badge.id} badge={badge} />
          ))}
        </span>
        <span className="listing-cell__meta">
          {isCard ? (
            identity?.variantLabel ? (
              <span>{identity.variantLabel}</span>
            ) : null
          ) : (
            <span className="listing-cell__offerid" title={row.externalId}>
              {row.externalId}
            </span>
          )}
          {identity?.sku ? (
            <span>
              SKU: <em>{identity.sku}</em>
            </span>
          ) : null}
          {!isCard && identity?.ean ? (
            <span>
              EAN: <em>{identity.ean}</em>
            </span>
          ) : null}
        </span>
        {alert ? (
          <span className="listing-cell__reason" title={alert.title}>
            {alert.text}
          </span>
        ) : null}
      </span>
    </span>
  );
}

function ChannelPill({ row, label }: { row: OfferMapping; label: string }): ReactElement {
  return (
    <span className="channel-pill" data-channel={row.platformType}>
      {label}
    </span>
  );
}

/**
 * The channel's own price, on one mono/tabular line. The age of the reading is
 * NOT repeated here: per #2024 the commercial snapshot is written by the same
 * `marketplace.offer.statusSync` pass as the status snapshot, so for
 * effectively every row it is the instant the Updated column already prints.
 * Printing it twice in two formats costs a line on every row and leaves the
 * operator to work out they are the same clock. It rides the cell's title
 * instead, which stays true for the quantity beside it.
 */
function PriceCell({ row }: { row: OfferMapping }): ReactElement {
  const commercial = row.commercial ?? null;
  if (!commercial) return <AbsentValue label="No channel reading yet" />;

  const readAt = `Price and quantity on channel, last read ${formatDateTime(
    commercial.lastCommercialSyncedAt,
  )}`;

  return (
    <span className="price-cell" title={readAt}>
      <span className="price-cell__value">
        {commercial.price == null ? (
          <AbsentValue label="Price not reported by the channel" />
        ) : (
          formatAmount(commercial.price, commercial.currency ?? undefined)
        )}
      </span>
    </span>
  );
}

function QuantityCell({ row }: { row: OfferMapping }): ReactElement {
  const commercial = row.commercial ?? null;
  // Nothing was ever persisted for this offer, so no reading was taken - which
  // is a different fact from a channel that answered and withheld the number.
  // On a connection whose status-sync task is off this is every row.
  if (!commercial) return <AbsentValue label="No channel reading yet" />;

  const quantity = commercial.availableQuantity;
  // Absence is not zero: a marketplace that reported no quantity says nothing
  // about whether the offer has stock.
  if (quantity == null) return <AbsentValue label="Quantity not reported by the channel" />;

  return (
    <span className="qty-cell">
      <span className="qty-cell__value">{quantity}</span>
      {quantity === 0 ? (
        <StatusBadge tone="error" compact withDot>
          Out of stock
        </StatusBadge>
      ) : null}
    </span>
  );
}

function UpdatedCell({ row }: { row: OfferMapping }): ReactElement {
  const syncedAt = row.channelStatus?.lastStatusSyncedAt;
  if (!syncedAt) return <AbsentValue label="Channel status never read" />;
  return <TimeDisplay className="time-cell" iso={syncedAt} format="datetime" />;
}

export function ListingsListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();

  const urlSearch = searchParams.get('search') ?? '';
  const urlConnectionId = searchParams.get('connectionId') ?? '';
  const offset = Number(searchParams.get('offset') ?? '0');

  const rawTab = searchParams.get('tab');
  const tab: LifecycleTab = isLifecycleTab(rawTab) ? rawTab : DEFAULT_TAB;
  const activeTabDef = LIFECYCLE_TABS.find((def) => def.key === tab) ?? LIFECYCLE_TABS[0];

  const [searchInput, setSearchInput] = useState(urlSearch);
  const [connectionIdInput, setConnectionIdInput] = useState(urlConnectionId);

  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);
  const debouncedConnectionId = useDebouncedValue(connectionIdInput, SEARCH_DEBOUNCE_MS);

  const filters: ListingsFilters = {
    search: debouncedSearch || undefined,
    connectionId: debouncedConnectionId || undefined,
    lifecycle: activeTabDef.lifecycle,
  };
  const pagination = { limit: PAGE_SIZE, offset };

  const query = useListingsQuery(filters, pagination);

  /**
   * Held separately from `query.data` so a tab switch - a distinct query key,
   * hence `query.isLoading` true for that fetch - does not blank every tab's
   * count badge back to skeleton (#2029 round 1 review). The five buckets are
   * unaffected by which tab is active (the backend excludes `lifecycle` from
   * the counts aggregate), so the last-known value stays correct while the
   * new tab's own rows load; only the very first-ever load has nothing to
   * fall back on and shows the skeleton.
   */
  const [lifecycleCounts, setLifecycleCounts] = useState<OfferLifecycleCounts | null>(null);
  useEffect(() => {
    if (query.data) {
      setLifecycleCounts(query.data.lifecycleCounts);
    }
  }, [query.data]);

  const platforms = usePlatforms();
  // One batched read for the whole page - the Connection column must never cost
  // a request per row (#1996).
  const connectionsQuery = useConnectionsQuery();
  const connectionsById = useMemo(() => {
    const map = new Map<string, ConnectionCellFacts>();
    for (const connection of connectionsQuery.data ?? []) {
      map.set(connection.id, { name: connection.name, status: connection.status });
    }
    return map;
  }, [connectionsQuery.data]);

  const channelLabel = useCallback(
    (row: OfferMapping): string => resolvePlatformLabel(platforms, row),
    [platforms],
  );

  const columns = useMemo<DataTableColumn<OfferMapping>[]>(
    () => [
      {
        id: 'listing',
        header: 'Listing',
        cell: (row): ReactNode => <ListingCell row={row} />,
      },
      {
        id: 'channel',
        header: 'Channel',
        cell: (row): ReactNode => <ChannelPill row={row} label={channelLabel(row)} />,
      },
      {
        id: 'connection',
        header: 'Connection',
        // `.get()` returns undefined on a miss, which ConnectionCell reads as
        // "resolve it yourself" and would turn back into a per-row fetch -
        // coalesce to null and hand it the batched query's loading state.
        cell: (row): ReactNode => (
          <ConnectionCell
            connectionId={row.connectionId}
            connection={connectionsById.get(row.connectionId) ?? null}
            loading={connectionsQuery.isLoading}
          />
        ),
      },
      {
        id: 'price',
        header: <ColumnHead label="Price" note="on channel" align="right" />,
        align: 'right',
        cell: (row): ReactNode => <PriceCell row={row} />,
      },
      {
        id: 'quantity',
        header: <ColumnHead label="Quantity" note="on channel" align="right" />,
        align: 'right',
        cell: (row): ReactNode => <QuantityCell row={row} />,
      },
      {
        id: 'updated',
        // Not "when this listing changed" - when OL last read the channel. The
        // hourly scan makes a days-old value ordinary, and the mobile card
        // already calls the identical value "Status read".
        header: <ColumnHead label="Updated" note="status read" />,
        cell: (row): ReactNode => <UpdatedCell row={row} />,
      },
    ],
    [channelLabel, connectionsById, connectionsQuery.isLoading],
  );

  function handleFilterChange(key: string, value: string): void {
    if (key === 'search') setSearchInput(value);
    if (key === 'connectionId') setConnectionIdInput(value);
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

  /**
   * Selecting a tab sets the `tab` URL param (omitted at the default 'active'
   * value, mirroring the `offset=0` omission convention below) and resets
   * paging - a tab switch always lands on page 1 of the new bucket (#2029).
   */
  function setTab(next: LifecycleTab): void {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === DEFAULT_TAB) {
        p.delete('tab');
      } else {
        p.set('tab', next);
      }
      p.delete('offset');
      return p;
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
      next.delete('connectionId');
      next.delete('offset');
      // The platform-type filter is gone (#2025) but a bookmarked URL can still
      // carry it - strip it so the address bar cannot claim a scope the table
      // no longer applies. FE-D (#2030) replaces it with a channel select.
      next.delete('platformType');
      return next;
    });
  }

  const hasFilters = !!(debouncedSearch || debouncedConnectionId);
  const total = query.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  // Distinct from the generic "connections exist but this bucket is empty"
  // case (#2029) - clearing filters can't help an operator with zero
  // connections configured, so it gets its own empty state + CTA.
  const noConnectionsConfigured =
    !connectionsQuery.isLoading && (connectionsQuery.data ?? []).length === 0;

  const demoMode = useDemoMode();
  // The unified "Publish products" entry opens a picker first — visible
  // (enabled) for a demo viewer per the useWriteAccess + ReadOnlyLock pattern
  // (#1615/#1613); the downstream wizard gates its own final submit (#1663).
  const write = useWriteAccess('listings:write', demoMode);

  const [isWizardOpen, setIsWizardOpen] = useState(false);

  return (
    <PageLayout
      eyebrow="Operations"
      title="Listings"
      description="Everything you sell on connected channels, and what state it is in right now."
      actions={
        write.visible ? (
          <Button onClick={() => setIsWizardOpen(true)}>Publish products</Button>
        ) : null
      }
    >
      <div className="toolbar toolbar--compact">
        <Input
          aria-label="Search listings by product name, SKU, EAN/GTIN or external ID"
          placeholder="Name, SKU, EAN/GTIN or external ID…"
          value={searchInput}
          onChange={(e) => {
            handleFilterChange('search', e.target.value);
          }}
        />
        <Input
          aria-label="Filter by connection ID"
          placeholder="Connection ID…"
          value={connectionIdInput}
          onChange={(e) => {
            handleFilterChange('connectionId', e.target.value);
          }}
        />
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (isLifecycleTab(value)) setTab(value);
        }}
      >
        <TabsList aria-label="Listing lifecycle">
          {LIFECYCLE_TABS.map((def) => (
            <TabsTrigger key={def.key} value={def.key}>
              {/* Explicit {' '} - not JSX whitespace, which collapses away
                  entirely - so the accessible name reads "Active 7", not the
                  run-on "Active7" (#2029 round 1 review). */}
              {def.label}{' '}
              <span className="tabs__count">
                {/* A count that snaps from 0 to its real value reads as a
                    bug (#2029 / mockup frame 04) - render a skeleton line
                    instead of a placeholder zero while it's unknown. Once any
                    counts have ever loaded, a tab switch keeps showing them
                    (rather than reverting to skeleton) so switching tabs never
                    blanks the four buckets that did not just change. */}
                {lifecycleCounts === null && query.isLoading ? (
                  <span className="tabs__count-skeleton" aria-hidden="true" />
                ) : (
                  (lifecycleCounts ?? query.data?.lifecycleCounts)?.[def.lifecycle] ?? '—'
                )}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        {/* Screen-reader-only counterpart to the skeleton-to-number transition
            above: DataTableSkeleton uses the same role/aria-live pattern for
            the row table, so the tab bar announces its own loading -> loaded
            transition the same way (#2029 round 1 review). */}
        <span className="sr-only" role="status" aria-live="polite">
          {lifecycleCounts ? 'Listing counts loaded.' : 'Loading listing counts…'}
        </span>

        <TabsContent value={tab}>
          {query.isLoading ? (
            <DataTableSkeleton columns={columns} />
          ) : query.error ? (
            <ErrorState
              title="Unable to load listings"
              message={query.error.message}
              action={
                <Button
                  onClick={() => {
                    void query.refetch();
                  }}
                >
                  Retry
                </Button>
              }
            />
          ) : (query.data?.items.length ?? 0) === 0 ? (
            hasFilters ? (
              <EmptyState
                liveRegion="off"
                title="No offer mappings found"
                message="No offer mappings match the current filters."
                action={<Button onClick={clearFilters}>Clear filters</Button>}
              />
            ) : noConnectionsConfigured ? (
              <EmptyState
                liveRegion="off"
                title="No channels connected yet"
                message="Listings are published to connected sales channels."
                action={
                  <Link className="button button--primary" to="/connections">
                    Connect a channel
                  </Link>
                }
              />
            ) : (
              <EmptyState
                liveRegion="off"
                title={activeTabDef.emptyTitle}
                message={activeTabDef.emptyMessage}
              />
            )
          ) : (
            <>
              <DataTable
                caption="Listings"
                // Scopes the identity column's width floor to this table - the
                // mockup put `min-width: 28rem` on `.data-table td:first-child`,
                // which here would reach ~12 unrelated tables (#2028).
                className="listings-table"
                columns={columns}
                rows={query.data?.items ?? []}
                rowKey={(m) => m.id}
                rowHref={(m) => m.id}
                cardView={{
                  title: (m) => <ListingCell row={m} shape="card" />,
                  // Channel / Connection / Price / Quantity as a two-column fact
                  // list — the four columns the fold drops (#1965 frame 05).
                  summary: (m) => (
                    <dl className="listings-card-facts">
                      <div>
                        <dt>Channel</dt>
                        <dd>
                          <ChannelPill row={m} label={channelLabel(m)} />
                        </dd>
                      </div>
                      <div>
                        <dt>Connection</dt>
                        <dd>
                          <ConnectionCell
                            connectionId={m.connectionId}
                            connection={connectionsById.get(m.connectionId) ?? null}
                            loading={connectionsQuery.isLoading}
                          />
                        </dd>
                      </div>
                      <div>
                        <dt>Price on channel</dt>
                        <dd>
                          <PriceCell row={m} />
                        </dd>
                      </div>
                      <div>
                        <dt>Quantity on channel</dt>
                        <dd>
                          <QuantityCell row={m} />
                        </dd>
                      </div>
                    </dl>
                  ),
                  // The long-form fields stay behind a disclosure so the card leads
                  // with the four facts above rather than a wall of identifiers.
                  collapsibleDetail: true,
                  detail: (m) => (
                    <KeyValueList
                      items={[
                        {
                          id: 'lifecycle',
                          label: 'Lifecycle',
                          value: m.channelStatus?.lifecycle ?? <EmptyValue />,
                        },
                        {
                          id: 'publicationStatus',
                          label: 'Channel status',
                          value: m.channelStatus?.publicationStatus ?? <EmptyValue />,
                          mono: true,
                        },
                        {
                          id: 'updated',
                          label: 'Status read',
                          value: <UpdatedCell row={m} />,
                        },
                        // The card head drops these two so the product name keeps
                        // its room at 360px (#1965 frame 05) - they stay reachable
                        // one tap away rather than disappearing.
                        {
                          id: 'externalId',
                          label: 'Offer ID',
                          value: m.externalId,
                          mono: true,
                        },
                        {
                          id: 'ean',
                          label: 'EAN/GTIN',
                          value: m.identity?.ean ?? (
                            <EmptyValue label="No EAN on the linked variant" />
                          ),
                          mono: true,
                        },
                        {
                          id: 'internalId',
                          label: 'Variant ID',
                          value: m.internalId,
                          mono: true,
                        },
                        {
                          id: 'validation',
                          label: 'Validator messages',
                          value: m.channelStatus?.validationMessages.length ? (
                            <ul className="listings-card-messages">
                              {m.channelStatus.validationMessages.map((message) => (
                                <li key={message}>{message}</li>
                              ))}
                            </ul>
                          ) : (
                            <EmptyValue label="No validator messages" />
                          ),
                        },
                      ]}
                    />
                  ),
                }}
              />

              <div className="pagination">
                <span className="text-muted">
                  Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
                </span>
                <div className="pagination__actions">
                  <Button
                    disabled={!hasPrev}
                    onClick={() => {
                      setOffset(offset - PAGE_SIZE);
                    }}
                  >
                    Previous
                  </Button>
                  <Button
                    disabled={!hasNext}
                    onClick={() => {
                      setOffset(offset + PAGE_SIZE);
                    }}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <OfferProductPickerModal isOpen={isWizardOpen} onClose={() => setIsWizardOpen(false)} />
    </PageLayout>
  );
}
