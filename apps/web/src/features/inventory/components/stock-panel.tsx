/**
 * Stock panel (#3569, mockup m25)
 *
 * The "Variants & stock" figures on the product detail page: a summary, one row
 * per variant and an expandable drawer. Master stock renders at once from the
 * page's own inventory read; available to promise, the held split and the
 * channel figures wait for the stock view and show a skeleton meanwhile.
 *
 * Three rules shape every cell. A `null` available to promise is "OpenLinker
 * does not know" and is never drawn as 0. Holds that count against it and holds
 * that are only recorded are different numbers. And a variant the master has
 * stopped reporting is labelled, not quietly zeroed.
 *
 * The correction dialog is not mounted here: `onAdjust` is the seam it hangs
 * off, and the button is DISABLED (not hidden) for a session without write
 * access, so a view-only user can see that the capability exists.
 *
 * @module apps/web/src/features/inventory/components
 */
import { Fragment, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { STOCK_STATUS_BADGE_TONE, STOCK_STATUS_LABEL } from '../../products';
import type { InventoryItem, StockViewVariant } from '../api/inventory.types';
import { useStockViewQuery } from '../hooks/use-stock-view-query';
import {
  deriveAtpStatus,
  formatStaleness,
  isAtpUnknown,
  isMultiLocation,
  isVariantStaled,
  publishedHolds,
  recordedOnlyHolds,
  summarizeStock,
} from '../lib/stock-view';
import { StockVariantDrawer, type StockRowState } from './stock-variant-drawer';

export interface StockPanelVariant {
  id: string;
  sku: string | null;
  attributes: Record<string, string> | null;
}

/** What the correction dialog needs to open for one variant. */
export interface StockAdjustTarget {
  variant: StockPanelVariant;
  /** `null` while the stock view is loading or failed - the dialog must not guess. */
  stock: StockViewVariant | null;
}

export interface StockPanelProps {
  productId: string;
  variants: readonly StockPanelVariant[];
  /** The page's own inventory read; master figures render from it at once. */
  inventoryItems: readonly InventoryItem[];
  /** Session may write stock. When false the button is disabled with a hint. */
  canAdjust: boolean;
  onAdjust?: (target: StockAdjustTarget) => void;
}

const VIEWER_HINT = 'Only admins and operators can adjust stock.';

interface Row {
  variant: StockPanelVariant;
  key: string;
  label: string | null;
  stock: StockViewVariant | null;
  state: StockRowState | 'loading';
  masterAvailable: number;
  masterReserved: number;
}

function Skeleton({ width }: { width: string }): ReactElement {
  return <span className="data-table-skeleton__bar av-skel" style={{ width }} aria-hidden="true"></span>;
}

function buildRows(
  variants: readonly StockPanelVariant[],
  inventoryItems: readonly InventoryItem[],
  stockByVariant: Map<string, StockViewVariant> | null,
  pending: boolean,
): Row[] {
  return variants.map((variant) => {
    const stock = stockByVariant?.get(variant.id) ?? null;
    const items = inventoryItems.filter((item) => item.productVariantId === variant.id);
    const masterAvailable =
      stock?.masterAvailable ?? items.reduce((sum, item) => sum + item.availableQuantity, 0);
    const masterReserved =
      stock?.masterReserved ?? items.reduce((sum, item) => sum + item.reservedQuantity, 0);
    const labelValues = Object.values(variant.attributes ?? {});
    let state: Row['state'];
    if (pending) state = 'loading';
    else if (!stock || isAtpUnknown(stock)) state = 'unknown';
    else if (isVariantStaled(stock)) state = 'staled';
    else state = 'ok';
    return {
      variant,
      key: variant.sku ?? variant.id,
      label: labelValues.length > 0 ? labelValues.join(' / ') : null,
      stock,
      state,
      masterAvailable,
      masterReserved,
    };
  });
}

export function StockPanel({
  productId,
  variants,
  inventoryItems,
  canAdjust,
  onAdjust,
}: StockPanelProps): ReactElement {
  const query = useStockViewQuery(productId);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const pending = query.isPending && !query.isError;
  const view = query.data ?? null;
  const stockByVariant = view ? new Map(view.variants.map((v) => [v.productVariantId, v])) : null;
  const rows = buildRows(variants, inventoryItems, stockByVariant, pending);
  const anyUnknown = !pending && rows.some((row) => row.state === 'unknown');
  const summary = view ? summarizeStock(view.variants) : null;
  const staleVariants = view ? view.variants.filter((v) => v.isStaleSync) : [];
  const everythingEmpty =
    view !== null && view.variants.length > 0 && view.variants.every((v) => v.positions.length === 0);
  const multiVariants = view ? view.variants.filter(isMultiLocation) : [];

  function toggle(key: string): void {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const oldestStale = staleVariants.reduce<StockViewVariant | null>((acc, v) => {
    if (acc === null || (v.observedAt ?? '') < (acc.observedAt ?? '')) return v;
    return acc;
  }, null);
  const staleConnection = oldestStale?.positions.find((p) => p.sourceConnectionId)?.sourceConnectionId ?? null;

  return (
    <div data-testid="stock-panel" aria-busy={pending}>
      {!canAdjust ? (
        <Alert data-testid="stock-viewer-notice" tone="info" title="You have view-only access">
          You can see stock and where each number comes from. Ask an admin or operator to adjust stock.
        </Alert>
      ) : null}

      {anyUnknown ? (
        <Alert
          data-testid="stock-unknown-alert"
          tone="warning"
          title="Available to promise is unknown right now"
          action={
            <Button
              tone="secondary"
              data-testid="stock-retry"
              onClick={() => {
                void query.refetch();
              }}
            >
              Try again
            </Button>
          }
        >
          OpenLinker couldn&apos;t read the units it holds for orders, so it can&apos;t say how many it may promise.
          Channel updates for these variants are on hold instead of being guessed. Master stock below is current.
        </Alert>
      ) : null}

      {view && staleVariants.length > 0 && oldestStale ? (
        <Alert
          data-testid="stock-stale-alert"
          tone="warning"
          title={
            oldestStale.stalenessMs !== null
              ? `Stock hasn't been refreshed for ${formatStaleness(oldestStale.stalenessMs).replace(' ago', '')}`
              : "Stock hasn't been refreshed recently"
          }
          action={
            staleConnection ? (
              <Link
                className="button button--secondary"
                to={`/connections/${encodeURIComponent(staleConnection)}`}
                data-testid="stock-stale-open-connection"
              >
                Open connection
              </Link>
            ) : undefined
          }
        >
          Stock counts as stale after {view.staleSyncThreshold.hours} h without an update.
          {oldestStale.observedAt ? (
            <>
              {' '}
              The last update arrived <TimeDisplay iso={oldestStale.observedAt} />.
            </>
          ) : null}{' '}
          The numbers below may be behind the shop.
        </Alert>
      ) : null}

      {multiVariants.length > 0 ? (
        <Alert
          data-testid="stock-multi-location-alert"
          tone="info"
          title={`${multiVariants.map((v) => v.sku ?? v.productVariantId).join(', ')} ${
            multiVariants.length === 1 ? 'has' : 'have'
          } stock in more than one place`}
        >
          Available to promise adds the places together. Holding units per location is out of the one-warehouse
          pilot, so OpenLinker can&apos;t hold units for new orders of {multiVariants.length === 1 ? 'this variant' : 'these variants'}
          {' '}until it knows which place ships them.
        </Alert>
      ) : null}

      {everythingEmpty ? (
        <div className="empty-state" data-testid="stock-empty">
          <h2>No stock recorded for this product yet</h2>
          <p>
            The master hasn&apos;t reported stock for this product. Until it does, OpenLinker counts it as 0
            available and channels show it as sold out.
          </p>
        </div>
      ) : (
        <>
          {pending ? (
            <p className="av-loading-note" data-testid="stock-loading">
              <span className="button__spinner" aria-hidden="true"></span>
              Working out available to promise for {variants.length} variant{variants.length === 1 ? '' : 's'}…
            </p>
          ) : null}

          <dl className="av-summary" data-testid="stock-summary">
            <div>
              <dt>Available to promise</dt>
              <dd className="av-summary__lead" data-testid="stock-summary-atp">
                {pending ? (
                  <Skeleton width="3rem" />
                ) : summary && summary.availableToPromise !== null ? (
                  summary.availableToPromise
                ) : (
                  <span className="av-unknown">Unknown</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Master stock</dt>
              <dd data-testid="stock-summary-master">
                {summary ? summary.masterStock : rows.reduce((sum, row) => sum + row.masterAvailable, 0)}
              </dd>
            </div>
            <div>
              <dt>Held by OpenLinker</dt>
              <dd data-testid="stock-summary-held">
                {pending ? (
                  <Skeleton width="2.5rem" />
                ) : summary && summary.heldCounted !== null ? (
                  summary.heldCounted
                ) : (
                  <span className="av-unknown">Couldn&apos;t read</span>
                )}
              </dd>
            </div>
            {multiVariants.length > 0 && summary ? (
              <div>
                <dt>Locations</dt>
                <dd>{summary.locationCount}</dd>
              </div>
            ) : (
              <div>
                <dt>Last synced</dt>
                <dd className="mono-text" data-testid="stock-summary-synced">
                  {summary?.lastSyncedAt ? <TimeDisplay iso={summary.lastSyncedAt} /> : pending ? <Skeleton width="5rem" /> : '—'}
                  {staleVariants.length > 0 && oldestStale?.stalenessMs != null ? (
                    <>
                      {' '}
                      <StatusBadge tone="warning" compact withDot>
                        {formatStaleness(oldestStale.stalenessMs)}
                      </StatusBadge>
                    </>
                  ) : null}
                </dd>
              </div>
            )}
          </dl>

          <div className="data-table__container">
            <table className="data-table av-table">
              <caption className="sr-only">Stock and availability per variant</caption>
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>Master stock</th>
                  <th>Held by OpenLinker</th>
                  <th>Available to promise</th>
                  <th className="data-table__cell--hide-below-768">Channels</th>
                  <th aria-hidden="true"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <VariantRows
                    key={row.variant.id}
                    row={row}
                    isOpen={open.has(row.key)}
                    onToggle={() => toggle(row.key)}
                    canAdjust={canAdjust}
                    onAdjust={onAdjust}
                    channelsStatus={view?.channelsStatus ?? 'ok'}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="av-panel-foot">
        <span className="muted-text" style={{ fontSize: '0.8125rem' }}>
          Channels get available to promise, minus each channel&apos;s own rules.
        </span>
        <Link
          to={
            variants.length === 1
              ? `/inventory/movements?productVariantId=${encodeURIComponent(variants[0].id)}`
              : `/inventory/movements?productId=${encodeURIComponent(productId)}`
          }
          className="button button--ghost"
          data-testid="stock-history-link"
        >
          View stock movements
        </Link>
      </div>
    </div>
  );
}

function VariantRows({
  row,
  isOpen,
  onToggle,
  canAdjust,
  onAdjust,
  channelsStatus,
}: {
  row: Row;
  isOpen: boolean;
  onToggle: () => void;
  canAdjust: boolean;
  onAdjust?: (target: StockAdjustTarget) => void;
  channelsStatus: 'ok' | 'partial' | 'unavailable';
}): ReactElement {
  const { key, state, stock } = row;
  const loading = state === 'loading';
  const staled = state === 'staled';
  const unknown = state === 'unknown';
  const multi = stock !== null && isMultiLocation(stock);
  const drawerId = `stock-drawer-panel-${key}`;
  const trClass = ['data-table__row', staled ? 'av-row--stale' : '', unknown ? 'av-row--unknown' : '']
    .filter(Boolean)
    .join(' ');

  const adjustDisabled = !canAdjust || staled || !onAdjust;
  const adjustHint = !canAdjust ? VIEWER_HINT : staled ? 'The master no longer reports this variant.' : undefined;

  return (
    <Fragment>
      <tr className={trClass} data-testid={`stock-variant-row-${key}`}>
        <td>
          <span className="mono-text">{key}</span>
          {row.label ? (
            <>
              <br />
              <span className="text-muted">{row.label}</span>
            </>
          ) : null}
          {!loading ? (
            <>
              <br />
              <button
                type="button"
                className="av-toggle"
                aria-expanded={isOpen}
                aria-controls={drawerId}
                data-testid={`stock-variant-toggle-${key}`}
                onClick={onToggle}
              >
                <span className="av-toggle__glyph" aria-hidden="true">
                  ▸
                </span>
                Details
              </button>
            </>
          ) : null}
        </td>
        <td data-testid={`stock-master-${key}`}>
          {staled ? (
            <>
              <span className="av-num">0</span>{' '}
              <StatusBadge tone="warning" compact withDot>
                Stale
              </StatusBadge>
            </>
          ) : (
            <>
              <span className="av-num">{row.masterAvailable}</span>
              {multi && stock ? (
                <span className="av-sub">in {stock.livePositionCount} locations</span>
              ) : row.masterReserved > 0 ? (
                <span className="av-sub">after {row.masterReserved} reserved in the master</span>
              ) : null}
            </>
          )}
        </td>
        <td data-testid={`stock-held-${key}`}>
          <HeldCell row={row} />
        </td>
        <td data-testid={`stock-atp-${key}`}>
          <AtpCell row={row} />
        </td>
        <td className="data-table__cell--hide-below-768">
          <ChannelsCell row={row} channelsStatus={channelsStatus} />
        </td>
        <td className="av-actions">
          <Button
            tone="ghost"
            disabled={adjustDisabled}
            title={adjustHint}
            data-testid={`stock-adjust-${key}`}
            onClick={() => onAdjust?.({ variant: row.variant, stock: row.stock })}
          >
            Adjust stock
          </Button>
        </td>
      </tr>
      {!loading && stock ? (
        <tr className="av-detail-row" id={drawerId} hidden={!isOpen}>
          <td colSpan={6}>
            <StockVariantDrawer
              rowKey={key}
              variantId={row.variant.id}
              state={state as StockRowState}
              stock={stock}
              channelsStatus={channelsStatus}
            />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function HeldCell({ row }: { row: Row }): ReactElement {
  const { stock, state } = row;
  if (state === 'loading') return <Skeleton width="2.5rem" />;
  if (state === 'unknown' || !stock || stock.heldCounted === null) {
    return <span className="av-unknown">Couldn&apos;t read</span>;
  }
  if (isMultiLocation(stock)) {
    return (
      <>
        <span className="av-num">0</span>
        <span className="av-sub">Can&apos;t hold - stock in {stock.livePositionCount} places</span>
      </>
    );
  }
  if (state === 'staled') return <span className="av-dash">—</span>;
  const orders = publishedHolds(stock.holds).length;
  const recordedOnly = stock.heldRecordedOnly ?? recordedOnlyHolds(stock.holds).reduce((s, h) => s + h.quantity, 0);
  return (
    <>
      <span className="av-num">{stock.heldCounted}</span>
      {stock.heldCounted > 0 ? (
        stock.holds !== null ? (
          <span className="av-sub">
            {orders} order{orders === 1 ? '' : 's'}
          </span>
        ) : null
      ) : (
        <span className="av-sub">None</span>
      )}
      {recordedOnly > 0 ? <span className="av-sub">+{recordedOnly} recorded only</span> : null}
    </>
  );
}

function AtpCell({ row }: { row: Row }): ReactElement {
  const { stock, state } = row;
  if (state === 'loading') return <Skeleton width="3rem" />;
  if (state === 'unknown' || !stock || stock.availableToPromise === null) {
    return (
      <>
        <span className="av-unknown" title="OpenLinker doesn't know. Not zero.">
          Unknown
        </span>
        <span className="av-sub">Not zero - updates on hold</span>
      </>
    );
  }
  const status = deriveAtpStatus(stock.availableToPromise);
  return (
    <>
      <span className="av-num av-num--lead">{stock.availableToPromise}</span>{' '}
      {status !== 'unknown' ? (
        <StatusBadge tone={STOCK_STATUS_BADGE_TONE[status]} compact withDot>
          {STOCK_STATUS_LABEL[status]}
        </StatusBadge>
      ) : null}
      {state === 'staled' ? (
        <span className="av-sub">Not counted - the master no longer reports it</span>
      ) : stock.isStaleSync && stock.observedAt ? (
        <span className="av-sub">
          As of <TimeDisplay iso={stock.observedAt} format="time" />
          {stock.stalenessMs !== null ? ` · ${formatStaleness(stock.stalenessMs)}` : ''}
        </span>
      ) : null}
    </>
  );
}

function ChannelsCell({
  row,
  channelsStatus,
}: {
  row: Row;
  channelsStatus: 'ok' | 'partial' | 'unavailable';
}): ReactElement {
  const { stock, state } = row;
  if (state === 'loading') return <Skeleton width="5rem" />;
  if (channelsStatus === 'unavailable') return <span className="av-dash">Couldn&apos;t list channels</span>;
  if (!stock || stock.channels.length === 0) return <span className="av-dash">Not published</span>;
  return (
    <div className="av-channels">
      {stock.channels.map((channel) => (
        <span key={channel.connectionId}>
          {channel.connectionName}{' '}
          {state === 'unknown' || channel.willPublish.quantity === null ? (
            <span className="av-unknown">On hold</span>
          ) : (
            <b>{channel.willPublish.quantity}</b>
          )}
        </span>
      ))}
    </div>
  );
}
