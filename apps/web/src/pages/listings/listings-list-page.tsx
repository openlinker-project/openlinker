/**
 * Listings List Page
 *
 * Operator-facing cockpit over offer-to-variant mappings (epic #2023, mockup
 * #1965): a 6-column table with channel-side price/quantity, 5 lifecycle tabs
 * (Active / Invalid / Draft / Ended / Unsynced) with live filter-aware counts,
 * and a toolbar (search + channel select). Backed entirely by `GET /listings`
 * (#2025/#2026) - no client-side filtering of a bucket's own page.
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
import { Alert } from '../../shared/ui/alert';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { Button } from '../../shared/ui/button';
import { AbsentValue } from '../../shared/ui/absent-value';
import { EmptyValue } from '../../shared/ui/empty-value';
import { Input } from '../../shared/ui/input';
import { Select } from '../../shared/ui/select';
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
import { readListingProblems } from '../../features/listings/lib/listing-problems';
import {
  deriveListingConnectionNotices,
  type ListingConnectionNotice,
} from '../../features/listings/lib/listing-connection-notices';
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
const LIFECYCLE_TAB_VALUES = ['active', 'invalid', 'draft', 'ended', 'unsynced'] as const;
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
    // Named `invalid`/`Invalid`, not `inactive`/`Inactive` (#2032 review
    // thread 9): Allegro's own INACTIVE means "not live", which this bucket
    // is not - see `OfferLifecycleValues`'s docblock for the full rationale.
    key: 'invalid',
    lifecycle: 'Invalid',
    label: 'Invalid',
    emptyTitle: 'No invalid listings',
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
            <span title={`SKU: ${identity.sku}`}>
              SKU: <em>{identity.sku}</em>
            </span>
          ) : null}
          {!isCard && identity?.ean ? (
            <span title={`EAN: ${identity.ean}`}>
              EAN: <em>{identity.ean}</em>
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

/**
 * One shop-level problem, rendered once for the whole connection (#2231).
 *
 * The channel reports these against every offer of the shop, so the rows drop
 * them and this carries them instead - naming the connection, because a page can
 * legitimately show two, and stating how many of the listings SHOWN are affected,
 * because the list is paged and filtered and cannot honestly claim a total.
 *
 * The title says the channel REPORTS a shop-level block, not that the shop
 * cannot sell: an offer whose channel status is `active` keeps its Active badge
 * even while carrying problems, because the channel is the authority on its own
 * publication - so a stronger claim here would contradict rows on the same
 * screen. The per-problem sentences below say what is blocked, in the channel's
 * own words.
 */
function ConnectionProblemNotice({ notice }: { notice: ListingConnectionNotice }): ReactElement {
  return (
    <Alert
      tone="error"
      className="listings-connection-notice"
      title={`${notice.connectionLabel} reports a shop-level block`}
    >
      <p>
        {notice.problems.map((problem) => problem.summary ?? problem.message).join(' \u00b7 ')} -
        this is reported against every listing on the connection, not against any one of them.
      </p>
      <ul className="listings-connection-notice__problems">
        {notice.problems.map((problem) => (
          <li key={problem.code ?? problem.message}>
            {problem.message}
            {problem.code !== undefined ? (
              <span className="listings-connection-notice__code mono-text">{problem.code}</span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-muted">
        {notice.affectedShownCount === 1
          ? '1 of the listings shown here is affected.'
          : `${notice.affectedShownCount} of the listings shown here are affected.`}
      </p>
    </Alert>
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
  const commercial = row.commercial ?? null;
  if (!commercial) return <AbsentValue label="No channel reading yet" />;

  const readAt = `Price and quantity on channel, last read ${formatDateTime(
    commercial.lastCommercialSyncedAt,
  )}`;
  const stale = isCommercialReadingStale(row);

  return (
    <span className="price-cell" title={readAt}>
      <span className="price-cell__value">
        {commercial.price == null ? (
          <AbsentValue label="Price not reported by the channel" />
        ) : (
          formatAmount(Number(commercial.price), commercial.currency ?? undefined)
        )}
      </span>
      <span className="sr-only">. {readAt}</span>
      {stale ? (
        <StatusBadge tone="warning" compact withDot className="price-cell__stale">
          <span title="This price reading is older than the latest channel status read">Stale</span>
          <span className="sr-only">
            . This price reading is older than the latest channel status read
          </span>
        </StatusBadge>
      ) : null}
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
  // A malformed `?offset=` (hand-edited, or a stale bookmark) must fall back
  // to page 1, not become `NaN` and 400 the request (#2032 review thread 12).
  const rawOffset = Number(searchParams.get('offset') ?? '0');
  const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

  const rawTab = searchParams.get('tab');
  const tab: LifecycleTab = isLifecycleTab(rawTab) ? rawTab : DEFAULT_TAB;
  const activeTabDef = LIFECYCLE_TABS.find((def) => def.key === tab) ?? LIFECYCLE_TABS[0];

  const [searchInput, setSearchInput] = useState(urlSearch);

  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);

  // The channel filter is a discrete <Select> value, not free text, so it
  // reads/writes the URL directly with no debounce - unlike search, there is
  // no keystroke-by-keystroke value to settle.
  const filters: ListingsFilters = {
    search: debouncedSearch || undefined,
    connectionId: urlConnectionId || undefined,
    lifecycle: activeTabDef.lifecycle,
    // This page is the only caller that renders a tab bar (#2032 review
    // thread 3) - `variant-stock-table.tsx` / `product-row-detail.tsx` /
    // `use-nav-counts.ts` share this same query hook and must not pay for
    // the aggregate's second full scan.
    includeLifecycleCounts: true,
  };
  const pagination = { limit: PAGE_SIZE, offset };

  const query = useListingsQuery(filters, pagination);

  /**
   * `useListingsQuery`'s `placeholderData: keepPreviousData` keeps `query.data`
   * (rows AND counts) populated with the PRIOR key's response while any new
   * key's fetch is in flight - tab, search, or connection change alike. That
   * is exactly right for the table (round-1 "blanking" fix): showing the
   * previous rows for a moment during any transition beats a full-page
   * skeleton on every keystroke.
   *
   * It is NOT right for `lifecycleCounts` on its own (round-2 fix; regression
   * caught by CI): `keepPreviousData` cannot tell "just switched tabs" apart
   * from "changed search/connection", but the two must be treated
   * oppositely. The counts genuinely don't change across a lifecycle-only
   * refetch (the backend computes every bucket regardless of which tab is
   * selected), so keeping the OLD counts visible while a tab's own rows load
   * is correct and was this page's very first requirement (#2029). But a
   * search/connection change makes the PRIOR counts describe a filter set
   * that no longer applies - keeping them visible, even briefly, is
   * dishonest, and dropping to the skeleton immediately (not waiting for the
   * new fetch, which may hang or error) is what a hand-rolled ref+fingerprint
   * used to guarantee. `keepPreviousData` alone regressed exactly that case,
   * so the fingerprint is restored here - scoped ONLY to `lifecycleCounts`,
   * deliberately excluding `lifecycle` itself so a tab switch never trips it.
   *
   * The ref is written from an effect, never during render: a render body must
   * stay side-effect-free, or a StrictMode double-invoke / a concurrent render
   * React discards would both stamp it. Writing after commit is equivalent
   * here, because the ref is only ever READ on a later, placeholder-serving
   * render - the render that receives fresh counts uses them directly.
   */
  const lifecycleCountsRef = useRef<{ fingerprint: string; counts: OfferLifecycleCounts } | null>(
    null,
  );
  const countsFingerprint = `${debouncedSearch}::${urlConnectionId}`;
  const freshLifecycleCounts =
    query.data?.lifecycleCounts && !query.isPlaceholderData ? query.data.lifecycleCounts : null;
  useEffect(() => {
    if (freshLifecycleCounts) {
      lifecycleCountsRef.current = {
        fingerprint: countsFingerprint,
        counts: freshLifecycleCounts,
      };
    }
  }, [countsFingerprint, freshLifecycleCounts]);
  const lifecycleCounts =
    freshLifecycleCounts ??
    (lifecycleCountsRef.current?.fingerprint === countsFingerprint
      ? lifecycleCountsRef.current.counts
      : null);

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

  // Shop-level channel problems, lifted out of the rows and grouped per
  // connection (#2231). Derived from the page's own rows: no extra request, and
  // the notice is therefore honest about counting only the listings shown.
  const connectionNotices = useMemo(
    () =>
      deriveListingConnectionNotices(
        query.data?.items ?? [],
        new Map([...connectionsById].map(([id, facts]) => [id, facts.name])),
      ),
    [query.data?.items, connectionsById],
  );

  const channelLabel = useCallback(
    (row: OfferMapping): string => resolvePlatformLabel(platforms, row),
    [platforms],
  );

  const columns = useMemo<DataTableColumn<OfferMapping>[]>(
    () => [
      {
        id: 'listing',
        header: 'Listing',
        cell: (row): ReactNode => <ListingCell row={row} activeLifecycle={activeTabDef.lifecycle} />,
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
    [channelLabel, connectionsById, connectionsQuery.isLoading, activeTabDef.lifecycle],
  );

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
      next.delete('offset');
      next.delete('tab');
      // The platform-type filter is gone (#2025/#2030) but a bookmarked URL can
      // still carry it - strip it so the address bar cannot claim a scope the
      // table no longer applies.
      next.delete('platformType');
      return next;
    });
  }

  const hasFilters = !!(debouncedSearch || urlConnectionId);
  const total = query.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

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
      <div className="toolbar toolbar--compact listings-toolbar">
        <div className="toolbar__group">
          <Input
            aria-label="Search listings by product name, SKU, EAN or external ID"
            placeholder="Product name, SKU, EAN or external ID"
            value={searchInput}
            onChange={(e) => {
              handleFilterChange('search', e.target.value);
            }}
          />
          {/* Channel select replaces the old raw connectionId/platformType text
              inputs (#2030) - populated from the same batched connections read
              already used for the Connection column (#1996), so it never costs
              a second request, and shows each connection's own NAME rather than
              its raw id or platformType. Scoped to OfferManager-capable
              connections (mirrors useProductMasterConnections' ProductMaster
              filter) - /listings is backed exclusively by offer mappings, so a
              ProductMaster/ProductPublisher-only connection can never produce a
              row here and would otherwise dead-end the table on selection. */}
          <Select
            aria-label="Filter by channel"
            value={urlConnectionId}
            onChange={(e) => {
              handleFilterChange('connectionId', e.target.value);
            }}
          >
            <option value="">All channels</option>
            {offerManagerConnections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.name}
              </option>
            ))}
          </Select>
        </div>
        <Button tone="ghost" className="button--sm" onClick={clearFilters}>
          Clear
        </Button>
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
                    instead of a placeholder zero while it's unknown.
                    Gated on `lifecycleCounts === null`, not `query.isPending`
                    (#2032 review round 2, regression caught by CI): the
                    fingerprint above already decides whether the counts on
                    hand are trustworthy for the CURRENT filters - a tab
                    switch keeps showing them (fingerprint unchanged), a
                    search/connection change drops to skeleton immediately
                    even though `isPending` stays false (placeholder data is
                    still present). */}
                {lifecycleCounts === null ? (
                  <span className="tabs__count-skeleton" aria-hidden="true" />
                ) : (
                  (lifecycleCounts[def.lifecycle] ?? '—')
                )}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        {/* Screen-reader-only counterpart to the skeleton-to-number transition
            above: DataTableSkeleton uses the same role/aria-live pattern for
            the row table, so the tab bar announces its own loading -> loaded
            transition the same way (#2029 round 1 review).
            One shared `role="status"` region, not two (#2032 review round 2,
            finding 2 fix, corrected post-CI): a second always-mounted
            `role="status"` node - even rendering empty text when not
            fetching - made every `getByRole('status')` query in this page's
            own test suite ambiguous. The refetch message takes priority
            while a fetch is in flight; otherwise this is the pre-existing
            lifecycle-counts announcement. */}
        <span className="sr-only" role="status" aria-live="polite">
          {query.isFetching && !query.isPending
            ? 'Refreshing listings…'
            : lifecycleCounts
              ? 'Listing counts loaded.'
              : 'Loading listing counts…'}
        </span>

        {/* `placeholderData: keepPreviousData` (round-1 fix) stops the table
            from blanking on a tab/search/page change, but until now nothing
            told the operator a NEW fetch was in flight while the PRIOR
            filter's rows stayed on screen (#2032 review round 2, finding 2) -
            an operator who types a search term and immediately scans the
            table could act on results that don't match what they just typed.
            `isFetching && !isPending`: excludes the very first load, which
            the skeleton below already owns. Visual-only (`aria-hidden`) - the
            shared status region above carries the a11y announcement. */}
        {query.isFetching && !query.isPending ? (
          <span className="listings-refetch-indicator" aria-hidden="true" />
        ) : null}

        {/* Only the active tab's data is ever fetched (one lifecycle-filtered
            request, not five), so the other four render an empty, forceMount'd
            panel purely so their trigger's `aria-controls` resolves to a real
            DOM node (#2032 review thread 12.1) - Radix always emits
            `aria-controls={contentId}` on every trigger regardless of whether
            a matching panel is mounted, and the APG tabs pattern requires each
            `tab` to reference its `tabpanel`. Radix sets the native `hidden`
            attribute on a forceMount'd, non-selected panel itself. */}
        {LIFECYCLE_TABS.filter((def) => def.key !== tab).map((def) => (
          <TabsContent key={def.key} value={def.key} forceMount />
        ))}

        <TabsContent value={tab}>
          {/* `isPending`, not `isLoading` (#2032 review thread 12.5): with
              `placeholderData: keepPreviousData` a tab/search/page change
              keeps `isLoading` momentarily true too, and gating the
              skeleton on it would still blank the table on every one of
              them - the exact symptom this fix removes. */}
          {query.isPending ? (
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
              // The default `Active` tab lands empty on a fresh install and
              // permanently on an Erli-only one (#2032 review thread 8): the
              // hourly status scan is 100 offers/tick, a wizard create writes
              // no snapshot at all, and Erli's status-sync scheduler defaults
              // OFF. The nav badge (total mappings) can read 40 while this
              // tab reads zero, which looks broken rather than "not synced
              // yet" - so a non-Unsynced empty tab whose Unsynced bucket
              // holds the catalog offers a direct way there instead of a
              // dead end.
              tab !== 'unsynced' && (lifecycleCounts?.Unsynced ?? 0) > 0 ? (
                <EmptyState
                  liveRegion="off"
                  title={activeTabDef.emptyTitle}
                  message={`${activeTabDef.emptyMessage} ${lifecycleCounts?.Unsynced} mapping(s) have never had their channel status read.`}
                  action={
                    <Button onClick={() => setTab('unsynced')}>
                      Show unsynced ({lifecycleCounts?.Unsynced})
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  liveRegion="off"
                  title={activeTabDef.emptyTitle}
                  message={activeTabDef.emptyMessage}
                />
              )
            )
          ) : (
            <>
              {connectionNotices.map((notice) => (
                <ConnectionProblemNotice key={notice.connectionId} notice={notice} />
              ))}
              <DataTable
                caption="Listings"
                // Scopes the identity column's width floor to this table - the
                // mockup put `min-width: 28rem` on `.data-table td:first-child`,
                // which here would reach ~12 unrelated tables (#2028).
                className="listings-table"
                // Freezes the Listing column so it stays visible while the
                // commercial columns scroll into view on a narrower desktop -
                // same pattern as orders/products, just 1 column here since
                // Listing (not a Channel/Connection pair) is the sole identity
                // anchor for this table.
                stickyLeftColumns={1}
                columns={columns}
                rows={query.data?.items ?? []}
                rowKey={(m) => m.id}
                rowHref={(m) => m.id}
                // The Listing cell is a tall composite (thumbnail + name line +
                // meta line), so the row link has to be a sized box or its
                // focus ring paints across the row's middle instead of around
                // it — see the prop's docblock.
                rowLinkDisplay="block"
                cardView={{
                  title: (m) => <ListingCell row={m} shape="card" activeLifecycle={activeTabDef.lifecycle} />,
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
                          label: 'Channel problems',
                          // The card's disclosure is the mobile counterpart of
                          // the publication-status panel, so it lists EVERY
                          // reason - shop-level ones included, since the notice
                          // above the list is off-screen by the time this is
                          // open (#2231).
                          value: readListingProblems(m.channelStatus).length ? (
                            <ul className="listings-card-messages">
                              {readListingProblems(m.channelStatus).map((problem, index) => (
                                <li key={`${problem.code ?? problem.message}:${index}`}>
                                  {problem.message}
                                  {problem.code !== undefined ? (
                                    <span className="problem-line__code mono-text">
                                      {problem.code}
                                    </span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <EmptyValue label="No problems reported" />
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
