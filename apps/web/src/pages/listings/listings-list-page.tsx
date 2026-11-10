/**
 * Listings List Page
 *
 * Operator-facing cockpit over offer-to-variant mappings (epic #2023, mockup
 * #1965), on the orders list system since #4046: a view switch in the page
 * head (All listings / Price changes), ONE lifecycle tab row (Active / Invalid
 * / Draft / Ended / Unsynced) with live filter-aware counts, "Needs a look"
 * (price changes, blocked by shop, selling deleted) from #4045, a toolbar
 * (search `/` + a Channel dropdown with counts) with applied pills, fixed
 * column widths, and a peek a row opens instead of leaving the page. Backed
 * entirely by `GET /listings` (#2025/#2026) - no client-side filtering of a
 * bucket's own page.
 *
 * @module apps/web/src/pages/listings
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import { AbsentValue } from '../../shared/ui/absent-value';
import { EmptyValue } from '../../shared/ui/empty-value';
import { Input } from '../../shared/ui/input';
import { ActiveFilterChips, type ActiveFilterChip } from '../../shared/ui/active-filter-chips';
import { PeekArrow } from '../../shared/ui/capped-badges';
import { FilterDropdown, FilterGroup } from '../../shared/ui/filter-dropdown';
import { SegmentedControl } from '../../shared/ui/segmented-control';
import { StatusTabs, type StatusTabTone } from '../../shared/ui/status-tabs';
import { KeyValueList } from '../../shared/ui/key-value-list';
import { ProductThumbnail } from '../../shared/ui/product-thumbnail';
import { StatusBadge } from '../../shared/ui/status-badge';
import { TimeDisplay } from '../../shared/ui/time-display';
import {
  interpolate,
  type Messages,
  type ResolvedCopy,
  useFormat,
  useMessages,
  usePlural,
} from '../../shared/i18n';
import { usePlatforms } from '../../shared/plugins';
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value';
import {
  ConnectionCell,
  useConnectionsQuery,
  type ConnectionCellFacts,
} from '../../features/connections';
import { resolvePlatformLabel } from '../../features/mappings';
import { useListingRowsQuery } from '../../features/listings/hooks/use-listings-query';
import { useListingsTotal } from '../../features/listings/hooks/use-listings-total';
import { ListPagination } from '../../shared/ui/list-pagination';
import { OfferProductPickerModal } from '../../features/listings/components/offer-product-picker-modal';
import {
  listingRowAlert,
  listingRowBadges,
  type ListingRowBadge,
} from '../../features/listings/lib/listing-row-state';
import { readListingProblems } from '../../features/listings/lib/listing-problems';
import { ListingAttentionSummary } from '../../features/listings/components/listing-attention-summary';
import { EditOfferDrawer } from '../../features/listings/components/edit-offer-drawer';
import { useRefreshListingStatusMutation } from '../../features/listings/hooks/use-refresh-listing-status-mutation';
import { useListingChannelCounts } from '../../features/listings/hooks/use-listing-channel-counts';
import { ListingPeek, type ListingPeekView } from './listing-peek';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { useDemoMode } from '../../features/system';
import { PriceChangesQueueTable, usePriceChangesQuery } from '../../features/price-changes';
import type {
  ListingsFilters,
  OfferLifecycle,
  OfferMapping,
} from '../../features/listings/api/listings.types';
import { describeApiError } from '../../shared/api/describe-api-error';

type ListingsListCopy = ResolvedCopy<Messages['listings']>['listingsListPage'];

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Lowercase URL-state token for each lifecycle bucket (#2029). Kept distinct
 * from the PascalCase `OfferLifecycle` the API speaks, mirroring the existing
 * `?health=` convention (`orders-list-page.tsx`) of a lowercase URL param.
 */
const LIFECYCLE_TAB_VALUES = ['active', 'invalid', 'draft', 'ended', 'unsynced'] as const;
type LifecycleTab = (typeof LIFECYCLE_TAB_VALUES)[number];

const DEFAULT_TAB: LifecycleTab = 'active';

/** Type-guard for the `tab` URL param, mirroring `isOrderHealth` in `orders-list-page.tsx`. */
function isLifecycleTab(value: string | null): value is LifecycleTab {
  return value !== null && (LIFECYCLE_TAB_VALUES as readonly string[]).includes(value);
}

/**
 * One entry per lifecycle tab: its URL token and the `OfferLifecycle` value it
 * filters by. Its label and its own empty-state copy (#2029) live in the
 * `listings.listingsListPage.lifecycleTabs` namespace under the same token -
 * each bucket means something different (see `offer-lifecycle.types.ts`
 * docblocks), so a single generic "no results" message would under-inform the
 * operator. Draft's copy deliberately does NOT say "not live yet": Draft also
 * holds an offer an operator deactivated weeks ago and will never relist.
 */
interface LifecycleTabDef {
  key: LifecycleTab;
  lifecycle: OfferLifecycle;
}

const LIFECYCLE_TABS: readonly LifecycleTabDef[] = [
  { key: 'active', lifecycle: 'Active' },
  // Named `invalid`/`Invalid`, not `inactive`/`Inactive` (#2032 review
  // thread 9): Allegro's own INACTIVE means "not live", which this bucket
  // is not - see `OfferLifecycleValues`'s docblock for the full rationale.
  { key: 'invalid', lifecycle: 'Invalid' },
  { key: 'draft', lifecycle: 'Draft' },
  { key: 'ended', lifecycle: 'Ended' },
  { key: 'unsynced', lifecycle: 'Unsynced' },
];

/** Tab dot per bucket (#4046): Invalid and Draft are tinted, the rest plain. */
const LIFECYCLE_TAB_TONE: Readonly<Record<LifecycleTab, StatusTabTone | null>> = {
  active: null,
  invalid: 'error',
  draft: 'warning',
  ended: null,
  unsynced: null,
};

/** The operator's word for a lifecycle bucket; an unknown value is shown as sent. */
function lifecycleLabel(lifecycle: string, copy: ListingsListCopy): string {
  const def = LIFECYCLE_TABS.find((entry) => entry.lifecycle === lifecycle);
  return def ? copy.lifecycleTabs[def.key].label : lifecycle;
}

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
  activeLifecycle,
}: {
  row: OfferMapping;
  shape?: 'row' | 'card';
  activeLifecycle?: OfferLifecycle;
}): ReactElement {
  const copy = useMessages('listings').listingsListPage.listingCell;
  const identity = row.identity ?? null;
  const badges = listingRowBadges(row, activeLifecycle);
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
              {identity ? copy.unnamedProduct : copy.noLinkedVariant}
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
            <span title={interpolate(copy.skuTitle, { sku: identity.sku })}>
              {copy.skuLabel} <em>{identity.sku}</em>
            </span>
          ) : null}
          {!isCard && identity?.ean ? (
            <span title={interpolate(copy.eanTitle, { ean: identity.ean })}>
              {copy.eanLabel} <em>{identity.ean}</em>
            </span>
          ) : null}
        </span>
        {alert ? (
          <span
            // Muted when the line reports a state rather than outstanding work,
            // so the red treatment keeps meaning "someone has to act" (#2231).
            className={
              alert.muted
                ? 'listing-cell__reason listing-cell__reason--muted'
                : 'listing-cell__reason'
            }
            title={alert.title}
          >
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
 * The commercial snapshot's own reading can go stale independently of the
 * "Updated" column: `upsertCommercialSnapshot` returns `'skipped'`/`'failed'`
 * on a status pass that otherwise succeeds (offer-status-sync.service.ts), so
 * the status clock advances while the price's own clock does not (#2032
 * review thread 7). One hour of slack absorbs the ordinary case where both
 * were written by the same pass a few seconds apart.
 */
const COMMERCIAL_STALE_THRESHOLD_MS = 60 * 60 * 1000;

function isCommercialReadingStale(row: OfferMapping): boolean {
  const commercial = row.commercial;
  const statusReadAt = row.channelStatus?.lastStatusSyncedAt ?? null;
  if (!commercial || !statusReadAt) return false;
  const drift =
    new Date(statusReadAt).getTime() - new Date(commercial.lastCommercialSyncedAt).getTime();
  return drift > COMMERCIAL_STALE_THRESHOLD_MS;
}

/**
 * The channel's own price, on one mono/tabular line. The reading's age used to
 * ride only the cell's `title` - invisible on touch, unreachable by keyboard,
 * with no screen-reader counterpart (#2032 review thread 7) - and the visible
 * "Updated" column prints `channelStatus.lastStatusSyncedAt`, the STATUS
 * clock, which diverges from the price's own clock exactly when the price is
 * stalest (a commercial write can fail while the status write it rode in on
 * succeeds). The age is now paired with an `sr-only` copy mirroring
 * `RowBadge`, and a divergence past the threshold earns its own visible badge
 * rather than staying silent in a tooltip.
 */
function PriceCell({ row }: { row: OfferMapping }): ReactElement {
  const copy = useMessages('listings').listingsListPage.cells;
  const format = useFormat();
  const commercial = row.commercial ?? null;
  if (!commercial) return <AbsentValue label={copy.noReadingYet} />;

  const readAt = interpolate(copy.priceReadAt, {
    readAt: format.dateTime(commercial.lastCommercialSyncedAt),
  });
  const stale = isCommercialReadingStale(row);

  return (
    <span className="price-cell" title={readAt}>
      <span className="price-cell__value">
        {commercial.price == null ? (
          <AbsentValue label={copy.priceNotReported} />
        ) : (
          format.money(Number(commercial.price), commercial.currency ?? undefined)
        )}
      </span>
      <span className="sr-only">. {readAt}</span>
      {stale ? (
        <StatusBadge tone="warning" compact withDot className="price-cell__stale">
          <span title={copy.staleTitle}>{copy.stale}</span>
          <span className="sr-only">. {copy.staleTitle}</span>
        </StatusBadge>
      ) : null}
    </span>
  );
}

function QuantityCell({ row }: { row: OfferMapping }): ReactElement {
  const copy = useMessages('listings').listingsListPage.cells;
  const format = useFormat();
  const commercial = row.commercial ?? null;
  // Nothing was ever persisted for this offer, so no reading was taken - which
  // is a different fact from a channel that answered and withheld the number.
  // On a connection whose status-sync task is off this is every row.
  if (!commercial) return <AbsentValue label={copy.noReadingYet} />;

  const quantity = commercial.availableQuantity;
  // Absence is not zero: a marketplace that reported no quantity says nothing
  // about whether the offer has stock.
  if (quantity == null) return <AbsentValue label={copy.quantityNotReported} />;

  return (
    <span className="qty-cell">
      <span className="qty-cell__value">{format.number(quantity)}</span>
      {quantity === 0 ? (
        <StatusBadge tone="error" compact withDot>
          {copy.outOfStock}
        </StatusBadge>
      ) : null}
    </span>
  );
}

function UpdatedCell({ row }: { row: OfferMapping }): ReactElement {
  const copy = useMessages('listings').listingsListPage.cells;
  const syncedAt = row.channelStatus?.lastStatusSyncedAt;
  if (!syncedAt) return <AbsentValue label={copy.statusNeverRead} />;
  return <TimeDisplay className="time-cell" iso={syncedAt} format="datetime" />;
}

export function ListingsListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const copy = useMessages('listings').listingsListPage;
  const plural = usePlural();
  const format = useFormat();

  const urlSearch = searchParams.get('search') ?? '';
  const urlConnectionId = searchParams.get('connectionId') ?? '';
  // "Needs a look" filters (#4045/#4046): present-and-set is the only state.
  const sellingDeleted = searchParams.get('staleSignal') === 'selling';
  const shopBlocked = searchParams.get('shopBlocked') === 'true';
  // A malformed `?offset=` (hand-edited, or a stale bookmark) must fall back
  // to page 1, not become `NaN` and 400 the request (#2032 review thread 12).
  const rawOffset = Number(searchParams.get('offset') ?? '0');
  const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

  const rawTab = searchParams.get('tab');
  const tab: LifecycleTab = isLifecycleTab(rawTab) ? rawTab : DEFAULT_TAB;
  const activeTabDef = LIFECYCLE_TABS.find((def) => def.key === tab) ?? LIFECYCLE_TABS[0];
  const activeTabCopy = copy.lifecycleTabs[activeTabDef.key];

  // Top-level view switch (#3147): "All listings" (everything below,
  // unchanged) vs "Price changes" (the new review queue). A permanent tab on
  // this page per the epic's placement decision — no promotion to a
  // dedicated nav surface is planned.
  const rawView = searchParams.get('view');
  const view: 'all' | 'queue' = rawView === 'queue' ? 'queue' : 'all';
  // The badge needs a real count on every visit (including the default "all
  // listings" tab), so the read itself stays enabled — but the standing 30s
  // BACKGROUND POLL only runs while the "Price changes" tab is actually on
  // screen (#3164 review): unconditionally passing the default interval here
  // meant every visit to `/listings` polled an unbounded, opt-in,
  // default-off feature's endpoint every 30s regardless of which tab was
  // showing.
  const priceChangesCountQuery = usePriceChangesQuery(undefined, {
    refetchIntervalMs: view === 'queue' ? undefined : false,
  });
  // `total` (from `countOpen`) is the strictly-open count a badge should
  // show — `items.length` also carries recently-ignored rows within their
  // 15-minute Undo window (#3162), which would overcount "needs your
  // attention" work.
  const priceChangesOpenCount = priceChangesCountQuery.data?.total ?? null;
  const priceChangesCountUnavailable = priceChangesCountQuery.isError;

  const [searchInput, setSearchInput] = useState(urlSearch);

  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);

  // The channel filter is a discrete <Select> value, not free text, so it
  // reads/writes the URL directly with no debounce - unlike search, there is
  // no keystroke-by-keystroke value to settle.
  const filters: ListingsFilters = {
    search: debouncedSearch || undefined,
    connectionId: urlConnectionId || undefined,
    lifecycle: activeTabDef.lifecycle,
    staleSignal: sellingDeleted ? 'selling' : undefined,
    shopBlocked: shopBlocked || undefined,
    // This page is the only caller that renders a tab bar (#2032 review
    // thread 3) - `variant-stock-table.tsx` / `product-row-detail.tsx` /
    // `use-nav-counts.ts` share this same query hook and must not pay for
    // the aggregate's second full scan.
    includeLifecycleCounts: true,
  };
  const pagination = { limit: PAGE_SIZE, offset };

  // Two-stage read (#2947): the rows do not wait for either aggregate over
  // this list's four-way join and `ILIKE` search.
  const query = useListingRowsQuery(filters, pagination);
  const totalStage = useListingsTotal(filters, query.data, query.isPlaceholderData);

  /**
   * The tab-bar buckets (#2947).
   *
   * The hand-rolled ref + fingerprint this replaced existed because the rows
   * and the counts shared ONE query under `placeholderData: keepPreviousData`,
   * which cannot tell "switched tabs" (keep the counts - they do not change)
   * from "changed search or connection" (drop them - they now describe a
   * filter set that no longer applies). They are separate queries now, and the
   * counts query is keyed WITHOUT `lifecycle`, so TanStack gives both
   * behaviours for free: a tab switch is a cache hit, and a search change is a
   * new key with no data.
   *
   * `null` while unknown, and rendered as a skeleton - never as zeroes, which
   * would state that every bucket is empty.
   */
  const lifecycleCounts = totalStage.lifecycleCounts;
  // The buckets are not merely late, they are not coming. Distinct from `null`,
  // which is "not yet" - see `lifecycleCountsState` (#2957 review, I2).
  const countsUnavailable =
    lifecycleCounts === null && totalStage.lifecycleCountsState === 'unavailable';

  /**
   * Are the rows on screen the PREVIOUS tab's? (#2957 review round 3, I3.)
   *
   * `keepPreviousData` holds the old page during every transition, but only one
   * of them is a hazard for the summary. The count query is keyed without
   * `lifecycle` and without pagination, so:
   *
   * - paging: the total is already correct, and suppressing it blanks
   *   "of 1,234" to "50+" and back on every click - the flicker this epic
   *   exists to remove, one layer up;
   * - search / channel change: the count key changes too, so the total is
   *   `null` on its own and suppression is a no-op;
   * - TAB SWITCH: the total re-derives for the NEW tab from buckets already in
   *   hand, while the rows are still the old tab's - so the summary would read
   *   "Showing 1-25 of 3", a range wider than its own total.
   *
   * Only the third is suppressed. The lifecycle the rows were fetched for is
   * tracked rather than inferred, because the rows page carries no lifecycle of
   * its own.
   */
  const rowsLifecycleRef = useRef(activeTabDef.lifecycle);
  useEffect(() => {
    if (!query.isPlaceholderData) rowsLifecycleRef.current = activeTabDef.lifecycle;
  }, [query.isPlaceholderData, activeTabDef.lifecycle]);
  const rowsAreForAnotherTab =
    query.isPlaceholderData && rowsLifecycleRef.current !== activeTabDef.lifecycle;

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

  // The row a peek is open on, and the offer the Edit drawer edits (#4046).
  const [peekId, setPeekId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<OfferMapping | null>(null);
  const refreshStatus = useRefreshListingStatusMutation();

  const channelLabel = useCallback(
    (row: OfferMapping): string => resolvePlatformLabel(platforms, row),
    [platforms],
  );

  const columns = useMemo<DataTableColumn<OfferMapping>[]>(
    () => [
      {
        id: 'listing',
        width: '40%',
        // #2538 - Thumbnail, title and a meta line.
        lines: 2,
        header: copy.columns.listing,
        cell: (row): ReactNode => <ListingCell row={row} activeLifecycle={activeTabDef.lifecycle} />,
      },
      {
        id: 'channel',
        width: '9%',
        header: copy.columns.channel,
        cell: (row): ReactNode => <ChannelPill row={row} label={channelLabel(row)} />,
      },
      {
        id: 'connection',
        width: '13%',
        // #2538 - ConnectionCell stacks the name over its status.
        lines: 2,
        header: copy.columns.connection,
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
        width: '12%',
        header: (
          <ColumnHead label={copy.columns.price} note={copy.columns.onChannel} align="right" />
        ),
        align: 'right',
        cell: (row): ReactNode => <PriceCell row={row} />,
      },
      {
        id: 'quantity',
        width: '10%',
        header: (
          <ColumnHead label={copy.columns.quantity} note={copy.columns.onChannel} align="right" />
        ),
        align: 'right',
        cell: (row): ReactNode => <QuantityCell row={row} />,
      },
      {
        id: 'updated',
        // Not "when this listing changed" - when OL last read the channel. The
        // hourly scan makes a days-old value ordinary, and the mobile card
        // already calls the identical value "Status read".
        header: <ColumnHead label={copy.columns.updated} note={copy.columns.statusRead} />,
        width: '12%',
        cell: (row): ReactNode => <UpdatedCell row={row} />,
      },
      {
        id: 'peek',
        width: '3rem',
        // #4046 - the arrow says the row opens a panel from the right.
        header: <span className="sr-only">{copy.peek.details}</span>,
        cell: (row): ReactNode => (
          <PeekArrow
            label={interpolate(copy.peek.detailsAria, {
              name: row.identity?.productName ?? row.externalId,
            })}
            onOpen={() => {
              setPeekId(row.id);
            }}
          />
        ),
      },
    ],
    [
      channelLabel,
      connectionsById,
      connectionsQuery.isLoading,
      activeTabDef.lifecycle,
      copy.columns,
      copy.peek,
    ],
  );

  /** A discrete filter (channel, needs-a-look) written straight to the URL. */
  function setParam(key: 'connectionId' | 'staleSignal' | 'shopBlocked', value: string | null): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete('offset');
      return next;
    });
  }

  function handleFilterChange(key: 'search' | 'connectionId', value: string): void {
    if (key === 'search') setSearchInput(value);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) {
          next.set(key, value);
        } else {
          next.delete(key);
        }
        next.delete('offset');
        return next;
      },
      // Every keystroke calls this for `search` (#2032 review thread 12.3) -
      // `useSearchParams` defaults to push, so typing "kurtka" would leave six
      // back-button steps to undo. A discrete connectionId change stays a
      // pushed entry, matching every other filter's back-button semantics.
      { replace: key === 'search' }
    );
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

  /**
   * Resets search, the channel filter and the lifecycle tab back to their
   * defaults in one URL-state update (#2030) - a plain `setSearchParams` call,
   * never `window.location`, so the table re-renders from the new (empty)
   * filter set without a full page reload.
   */
  function clearFilters(): void {
    setSearchInput('');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('search');
      next.delete('connectionId');
      next.delete('staleSignal');
      next.delete('shopBlocked');
      next.delete('offset');
      next.delete('tab');
      // The platform-type filter is gone (#2025/#2030) but a bookmarked URL can
      // still carry it - strip it so the address bar cannot claim a scope the
      // table no longer applies.
      next.delete('platformType');
      return next;
    });
  }

  const hasFilters = !!(debouncedSearch || urlConnectionId || sellingDeleted || shopBlocked);

  /** Pills clear every filter but the tab (#4046); the empty state still resets the tab too. */
  function clearPills(): void {
    setSearchInput('');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const key of ['search', 'connectionId', 'staleSignal', 'shopBlocked', 'offset']) next.delete(key);
      return next;
    });
  }

  // /listings is backed exclusively by OfferManager-capable connections (the
  // channel <Select> below filters on the same capability) - a shop with only
  // ProductMaster/ProductPublisher connections has zero of these and would
  // otherwise fall through to the generic "not synced yet" empty state
  // (#2032 review round 2, finding 1), which reads as a broken feature rather
  // than "connect a marketplace to use this page".
  const offerManagerConnections = (connectionsQuery.data ?? []).filter((connection) =>
    connection.enabledCapabilities.includes('OfferManager'),
  );
  // Distinct from the generic "connections exist but this bucket is empty"
  // case (#2029) - clearing filters can't help an operator with zero
  // connections configured, so it gets its own empty state + CTA.
  const noConnectionsConfigured = !connectionsQuery.isLoading && offerManagerConnections.length === 0;

  const channelCounts = useListingChannelCounts(
    filters,
    offerManagerConnections.map((connection) => connection.id),
  );

  const peekIndex = peekId ? (query.data?.items ?? []).findIndex((row) => row.id === peekId) : -1;
  const peekRow = peekIndex >= 0 ? query.data?.items[peekIndex] : undefined;
  const navigatePeek = useCallback(
    (step: -1 | 1): void => {
      const next = query.data?.items[peekIndex + step];
      if (next) setPeekId(next.id);
    },
    [query.data?.items, peekIndex],
  );

  const demoMode = useDemoMode();
  // The unified "Publish products" entry opens a picker first — visible
  // (enabled) for a demo viewer per the useWriteAccess + ReadOnlyLock pattern
  // (#1615/#1613); the downstream wizard gates its own final submit (#1663).
  const write = useWriteAccess('listings:write', demoMode);

  const [isWizardOpen, setIsWizardOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function onKeydown(e: KeyboardEvent): void {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key !== '/') return;
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      searchRef.current?.focus();
    }
    document.addEventListener('keydown', onKeydown);
    return () => {
      document.removeEventListener('keydown', onKeydown);
    };
  }, []);

  const connectionName = (connectionId: string): string | null =>
    connectionsById.get(connectionId)?.name ?? null;

  const chips: ActiveFilterChip[] = [];
  if (searchInput) {
    const text = `“${searchInput}”`;
    chips.push({
      key: 'search',
      label: copy.pills.search,
      value: text,
      valueText: text,
      onRemove: () => {
        handleFilterChange('search', '');
      },
    });
  }
  if (urlConnectionId) {
    const text = connectionName(urlConnectionId) ?? urlConnectionId;
    chips.push({
      key: 'channel',
      label: copy.pills.channel,
      value: text,
      valueText: text,
      onRemove: () => {
        setParam('connectionId', null);
      },
    });
  }
  if (shopBlocked) {
    chips.push({
      key: 'shopBlocked',
      label: copy.pills.needsALook,
      value: copy.pills.shopBlocked,
      valueText: copy.pills.shopBlocked,
      onRemove: () => {
        setParam('shopBlocked', null);
      },
    });
  }
  if (sellingDeleted) {
    chips.push({
      key: 'sellingDeleted',
      label: copy.pills.needsALook,
      value: copy.pills.sellingDeleted,
      valueText: copy.pills.sellingDeleted,
      onRemove: () => {
        setParam('staleSignal', null);
      },
    });
  }

  const statusTabs = LIFECYCLE_TABS.map((def) => ({
    key: def.key,
    label: copy.lifecycleTabs[def.key].label,
    tone: LIFECYCLE_TAB_TONE[def.key],
    count: lifecycleCounts?.[def.lifecycle] ?? undefined,
  }));

  const peekView: ListingPeekView | null = peekRow
    ? {
        row: peekRow,
        title: peekRow.identity?.productName ?? copy.listingCell.noLinkedVariant,
        thumbnail: (
          <ProductThumbnail
            name={peekRow.identity?.productName ?? peekRow.externalId}
            src={peekRow.identity?.imageUrl ?? null}
            size="sm"
          />
        ),
        variant: peekRow.identity?.variantLabel ?? null,
        connection: (
          <ConnectionCell
            connectionId={peekRow.connectionId}
            connection={connectionsById.get(peekRow.connectionId) ?? null}
            loading={connectionsQuery.isLoading}
          />
        ),
        price: <PriceCell row={peekRow} />,
        lifecycle: (
          <span className="listing-peek__badges">
            {peekRow.channelStatus?.lifecycle ? (
              <StatusBadge tone="neutral" compact withDot>
                {lifecycleLabel(peekRow.channelStatus.lifecycle, copy)}
              </StatusBadge>
            ) : null}
            {listingRowBadges(peekRow).map((badge) => (
              <RowBadge key={badge.id} badge={badge} />
            ))}
          </span>
        ),
        onChannel: (
          <span className="listing-peek__on-channel">
            <PriceCell row={peekRow} />
            <span className="text-muted" aria-hidden="true">
              ·
            </span>
            <QuantityCell row={peekRow} />
          </span>
        ),
        statusRead: <UpdatedCell row={peekRow} />,
        channel: channelLabel(peekRow),
        reason: listingRowAlert(peekRow),
        onEdit: write.visible
          ? (): void => {
              setEditTarget(peekRow);
            }
          : undefined,
        onCheckStatus: write.visible
          ? (): void => {
              refreshStatus.mutate(peekRow);
            }
          : undefined,
        checkingStatus: refreshStatus.isPending,
      }
    : null;

  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      actions={
        <span className="button-group listings-head-actions">
          {/* The view switch (#3147) moved here from a tab row of its own
              (#4046), so the lifecycle row is the page's ONLY tab row. */}
          <SegmentedControl<'all' | 'queue'>
            aria-label={copy.views.ariaLabel}
            value={view}
            onChange={(value) => {
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                if (value === 'queue') next.set('view', 'queue');
                else next.delete('view');
                return next;
              });
            }}
            options={[
              { value: 'all', label: copy.views.all },
              {
                value: 'queue',
                label: (
                  <>
                    {copy.views.priceChanges}{' '}
                    <span className="seg-count tabular">
                      {/* Never a placeholder 0, and a FAILED read never 0
                          either (#3164 review): unknown is a skeleton,
                          unavailable a dash. */}
                      {priceChangesCountUnavailable ? (
                        <span
                          role="img"
                          aria-label={copy.views.countUnavailable}
                          title={copy.views.countUnavailable}
                        >
                          -
                        </span>
                      ) : priceChangesOpenCount === null ? (
                        <span className="tabs__count-skeleton" aria-hidden="true" />
                      ) : (
                        format.number(priceChangesOpenCount)
                      )}
                    </span>
                  </>
                ),
              },
            ]}
          />
          {write.visible ? (
            <Button onClick={() => setIsWizardOpen(true)}>{copy.publishProducts}</Button>
          ) : null}
        </span>
      }
    >
      {view === 'queue' ? (
        <PriceChangesQueueTable />
      ) : (
        <>
          <div className="list-statusbar">
            <StatusTabs<LifecycleTab>
              tabs={statusTabs}
              value={tab}
              onChange={(next) => {
                setTab(next ?? DEFAULT_TAB);
              }}
              aria-label={copy.lifecycleAriaLabel}
            />
            <ListingAttentionSummary
              priceChanges={priceChangesCountUnavailable ? null : priceChangesOpenCount}
              onReviewPriceChanges={() => {
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev);
                  next.set('view', 'queue');
                  return next;
                });
              }}
              attention={totalStage.attentionCounts}
              shopBlocked={shopBlocked}
              onShowShopBlocked={(connectionId) => {
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev);
                  next.set('shopBlocked', 'true');
                  if (connectionId) next.set('connectionId', connectionId);
                  next.delete('offset');
                  return next;
                });
              }}
              onClearShopBlocked={() => {
                setParam('shopBlocked', null);
              }}
              sellingDeleted={sellingDeleted}
              onSellingDeletedChange={(on) => {
                setParam('staleSignal', on ? 'selling' : null);
              }}
              connectionName={connectionName}
            />
          </div>

          {/* Screen-reader counterpart to the tab counts and the refetch line:
              ONE shared `role="status"` region (#2032 review round 2). */}
          <span className="sr-only" role="status" aria-live="polite">
            {query.isFetching && !query.isPending
              ? copy.status.refreshing
              : lifecycleCounts
                ? copy.status.countsLoaded
                : countsUnavailable
                  ? copy.status.countsUnavailable
                  : copy.status.countsLoading}
          </span>

          <div className="list-filters">
            <div className="list-toolbar">
              <div className="list-search">
                <span className="list-search__glyph" aria-hidden="true">
                  ⌕
                </span>
                <Input
                  ref={searchRef}
                  type="search"
                  aria-label={copy.toolbar.searchAriaLabel}
                  placeholder={copy.toolbar.searchPlaceholder}
                  value={searchInput}
                  onChange={(e) => {
                    handleFilterChange('search', e.target.value);
                  }}
                />
                <span className="button__shortcut list-search__kbd" aria-hidden="true">
                  /
                </span>
              </div>
              {/* Scoped to OfferManager-capable connections: /listings is
                  backed exclusively by offer mappings, so any other connection
                  could never produce a row here (#2030). */}
              <FilterGroup aria-label={copy.toolbar.filterGroupAria}>
                <FilterDropdown
                  label={copy.toolbar.channel}
                  anyLabel={copy.toolbar.allChannels}
                  value={urlConnectionId || null}
                  options={offerManagerConnections.map((connection) => ({
                    value: connection.id,
                    label: connection.name,
                    count: channelCounts.get(connection.id),
                  }))}
                  onChange={(next) => {
                    setParam('connectionId', next);
                  }}
                />
              </FilterGroup>
              <span className="list-toolbar__spacer" />
              <span className="text-muted mono tabular list-results" aria-live="polite">
                {totalStage.total === null || rowsAreForAnotherTab
                  ? null
                  : plural(totalStage.total, copy.toolbar.results, { total: format.number(totalStage.total) })}
              </span>
              {query.isFetching && !query.isPending ? (
                <span className="listings-refetch-indicator" aria-hidden="true" />
              ) : null}
            </div>
            <ActiveFilterChips chips={chips} onClearAll={clearPills} clearAllLabel={copy.toolbar.clearAll} />
          </div>

          {/* `isPending`, not `isLoading` (#2032 review thread 12.5): with
              `placeholderData: keepPreviousData` a tab/search/page change
              keeps `isLoading` momentarily true too, and gating the skeleton
              on it would blank the table on every one of them. */}
          {query.isPending ? (
            <DataTableSkeleton columns={columns} label={copy.loading} />
          ) : query.error ? (
            <ErrorState
              title={copy.errorTitle}
              message={describeApiError(query.error, 'listings')}
              action={
                <Button
                  onClick={() => {
                    void query.refetch();
                  }}
                >
                  {copy.retry}
                </Button>
              }
            />
          ) : (query.data?.items.length ?? 0) === 0 ? (
            hasFilters ? (
              <EmptyState
                liveRegion="off"
                title={copy.empty.filteredTitle}
                message={copy.empty.filteredMessage}
                action={<Button onClick={clearFilters}>{copy.empty.clearFilters}</Button>}
              />
            ) : noConnectionsConfigured ? (
              <EmptyState
                liveRegion="off"
                title={copy.empty.noChannelsTitle}
                message={copy.empty.noChannelsMessage}
                action={
                  <Link className="button button--primary" to="/connections">
                    {copy.empty.connectChannel}
                  </Link>
                }
              />
            ) : // The default `Active` tab lands empty on a fresh install and
            // permanently on an Erli-only one (#2032 review thread 8), so a
            // non-Unsynced empty tab whose Unsynced bucket holds the catalogue
            // offers a direct way there instead of a dead end.
            tab !== 'unsynced' && (lifecycleCounts?.Unsynced ?? 0) > 0 ? (
              <EmptyState
                liveRegion="off"
                title={activeTabCopy.emptyTitle}
                message={`${activeTabCopy.emptyMessage} ${plural(
                  lifecycleCounts?.Unsynced ?? 0,
                  copy.empty.unsyncedHint,
                )}`}
                action={
                  <Button onClick={() => setTab('unsynced')}>
                    {interpolate(copy.empty.showUnsynced, {
                      count: format.number(lifecycleCounts?.Unsynced ?? 0),
                    })}
                  </Button>
                }
              />
            ) : (
              <EmptyState liveRegion="off" title={activeTabCopy.emptyTitle} message={activeTabCopy.emptyMessage} />
            )
          ) : (
            <>
              <DataTable
                caption={copy.title}
                // `listings-table` scopes the identity column's floor (#2028);
                // fixed widths keep every column still across tabs (#4046).
                className="listings-table list-table--fixed list-table--peek"
                // Listing is the sole identity anchor; the peek arrow is pinned right.
                stickyLeftColumns={1}
                stickyRightColumns={1}
                columns={columns}
                rows={query.data?.items ?? []}
                rowKey={(m) => m.id}
                onRowClick={(m) => {
                  setPeekId(m.id);
                }}
                rowClassName={(m) => (m.id === peekId ? 'list-row--peek' : undefined)}
                cardView={{
                  title: (m) => <ListingCell row={m} shape="card" activeLifecycle={activeTabDef.lifecycle} />,
                  // Channel / Connection / Price / Quantity as a two-column fact
                  // list — the four columns the fold drops (#1965 frame 05).
                  summary: (m) => (
                    <dl className="listings-card-facts">
                      <div>
                        <dt>{copy.card.channel}</dt>
                        <dd>
                          <ChannelPill row={m} label={channelLabel(m)} />
                        </dd>
                      </div>
                      <div>
                        <dt>{copy.card.connection}</dt>
                        <dd>
                          <ConnectionCell
                            connectionId={m.connectionId}
                            connection={connectionsById.get(m.connectionId) ?? null}
                            loading={connectionsQuery.isLoading}
                          />
                        </dd>
                      </div>
                      <div>
                        <dt>{copy.card.priceOnChannel}</dt>
                        <dd>
                          <PriceCell row={m} />
                        </dd>
                      </div>
                      <div>
                        <dt>{copy.card.quantityOnChannel}</dt>
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
                          label: copy.card.lifecycle,
                          value: m.channelStatus?.lifecycle ? (
                            lifecycleLabel(m.channelStatus.lifecycle, copy)
                          ) : (
                            <EmptyValue />
                          ),
                        },
                        {
                          id: 'publicationStatus',
                          label: copy.card.channelStatus,
                          value: m.channelStatus?.publicationStatus ?? <EmptyValue />,
                          mono: true,
                        },
                        {
                          id: 'updated',
                          label: copy.card.statusRead,
                          value: <UpdatedCell row={m} />,
                        },
                        {
                          id: 'externalId',
                          label: copy.card.offerId,
                          value: m.externalId,
                          mono: true,
                        },
                        {
                          id: 'ean',
                          label: copy.card.ean,
                          value: m.identity?.ean ?? <EmptyValue label={copy.card.noEan} />,
                          mono: true,
                        },
                        {
                          id: 'internalId',
                          label: copy.card.variantId,
                          value: m.internalId,
                          mono: true,
                        },
                        {
                          id: 'validation',
                          label: copy.card.channelProblems,
                          // Every reason, shop-level ones included (#2231).
                          value: readListingProblems(m.channelStatus).length ? (
                            <ul className="listings-card-messages">
                              {readListingProblems(m.channelStatus).map((problem, index) => (
                                <li key={`${problem.code ?? problem.message}:${index}`}>
                                  {problem.message}
                                  {problem.code !== undefined ? (
                                    <span className="problem-line__code mono-text">{problem.code}</span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <EmptyValue label={copy.card.noProblems} />
                          ),
                        },
                      ]}
                    />
                  ),
                }}
              />

              {/* For a tab switch the rows may still be the PREVIOUS tab's
                  while the total already describes the new one (#2957 review,
                  I1) - see `rowsAreForAnotherTab`. */}
              <ListPagination
                offset={offset}
                limit={PAGE_SIZE}
                rowCount={query.data?.items.length ?? 0}
                total={rowsAreForAnotherTab ? null : totalStage.total}
                totalState={rowsAreForAnotherTab ? 'settling' : totalStage.state}
                showTotalLoader={totalStage.showLoader}
                rowsArePlaceholder={query.isPlaceholderData}
                onOffsetChange={setOffset}
              />
            </>
          )}

          <ListingPeek
            view={peekView}
            position={peekIndex + 1}
            count={query.data?.items.length ?? 0}
            onNavigate={navigatePeek}
            onOpenChange={(open) => {
              if (!open) setPeekId(null);
            }}
          />
          {editTarget ? (
            <EditOfferDrawer
              isOpen
              mapping={editTarget}
              onClose={() => {
                setEditTarget(null);
              }}
            />
          ) : null}
        </>
      )}
      <OfferProductPickerModal isOpen={isWizardOpen} onClose={() => setIsWizardOpen(false)} />
    </PageLayout>
  );
}
