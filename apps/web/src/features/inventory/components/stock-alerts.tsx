/**
 * Stock alerts (#3569, mockup m25)
 *
 * Everything the product page has to say about stock that is not a number in
 * the variants table: the view-only notice, the role restriction, the "not
 * known" and "gone stale" warnings, the two cases where more than one place
 * counts a variant, the empty state and the loading note. They render ABOVE the
 * table so the figures below are never read without them.
 *
 * Each state keeps the test id it had when this was a panel of its own.
 *
 * @module apps/web/src/features/inventory/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { TimeDisplay } from '../../../shared/ui/time-display';
import type { StockView, StockViewVariant } from '../api/inventory.types';
import { useConnectionNames } from '../hooks/use-connection-names';
import { formatStaleness } from '../lib/stock-view';
import type { StockRowModel } from '../lib/stock-row';

export interface StockAlertsProps {
  rows: ReadonlyMap<string, StockRowModel>;
  view: StockView | null;
  /** The session may not read the stock view (role, or the server said so). */
  restricted: boolean;
  /** The stock view is still loading. */
  pending: boolean;
  canAdjust: boolean;
  onRetry: () => void;
  /** The connection that owns this product's stock, for the empty state's next step. */
  masterConnectionId?: string | null;
}

function variantName(row: StockRowModel): string {
  return row.variant.sku ?? row.variant.id;
}

function joinNames(names: readonly string[]): string {
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function StockAlerts({
  rows,
  view,
  restricted,
  pending,
  canAdjust,
  onRetry,
  masterConnectionId = null,
}: StockAlertsProps): ReactElement | null {
  const connectionNames = useConnectionNames();
  const list = [...rows.values()];
  const anyUnknown = !pending && !restricted && list.some((row) => row.state === 'unknown');
  const staleVariants: StockViewVariant[] = view ? view.variants.filter((v) => v.isStaleSync) : [];
  const oldestStale = staleVariants.reduce<StockViewVariant | null>((acc, v) => {
    if (acc === null || (v.observedAt ?? '') < (acc.observedAt ?? '')) return v;
    return acc;
  }, null);
  const staleConnection = oldestStale?.positions.find((p) => p.sourceConnectionId)?.sourceConnectionId ?? null;
  const staleConnectionName = staleConnection ? (connectionNames.get(staleConnection) ?? null) : null;
  const everythingEmpty =
    view !== null && view.variants.length > 0 && view.variants.every((v) => v.positions.length === 0);
  const multiLocationRows = list.filter((row) => row.multiLocation && !row.multiSource);
  const multiSourceRows = list.filter((row) => row.multiSource);
  const goneRows = list.filter((row) => row.state === 'staled');
  const masterName = masterConnectionId ? (connectionNames.get(masterConnectionId) ?? null) : null;

  return (
    <div data-testid="stock-alerts" aria-busy={pending}>
      {!canAdjust ? (
        <Alert data-testid="stock-viewer-notice" tone="info" density="compact">
          You have view-only access. Ask an admin or operator to change stock.
        </Alert>
      ) : null}

      {restricted ? (
        <Alert data-testid="stock-restricted-notice" tone="info" title="How much you can sell isn't shown to your role">
          The count in the shop is current. What you can sell, what is reserved and what each channel gets are
          visible to admins, operators and viewers.
        </Alert>
      ) : null}

      {anyUnknown ? (
        <Alert
          data-testid="stock-unknown-alert"
          tone="warning"
          title="Stock for this product isn't known right now"
          action={
            <Button tone="secondary" data-testid="stock-retry" onClick={onRetry}>
              Try again
            </Button>
          }
        >
          OpenLinker couldn&apos;t read the reserved count, so it shows no number and isn&apos;t sending stock to
          your channels. Nothing was changed.
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
          {oldestStale.observedAt ? (
            <>
              {staleConnectionName ?? 'The shop'} last answered <TimeDisplay iso={oldestStale.observedAt} />.{' '}
            </>
          ) : null}
          OpenLinker hasn&apos;t sent your channels a new number since then. Stock counts as stale after{' '}
          {view.staleSyncThreshold.hours} h without an update.
        </Alert>
      ) : null}

      {multiSourceRows.length > 0 ? (
        <Alert data-testid="stock-multi-source-alert" tone="warning" density="compact">
          {joinNames(multiSourceRows.map(variantName))} {multiSourceRows.length === 1 ? 'is' : 'are'} counted by{' '}
          {joinNames([...new Set(multiSourceRows.flatMap((row) => row.sourceNames))])}, and the counts are added
          together. Corrections for {multiSourceRows.length === 1 ? 'it' : 'them'} are off and new orders
          don&apos;t reserve {multiSourceRows.length === 1 ? 'it' : 'them'}.{' '}
          <Link to="/connections">See the connections</Link>
        </Alert>
      ) : null}

      {multiLocationRows.length > 0 ? (
        <Alert data-testid="stock-multi-location-alert" tone="info" density="compact">
          {joinNames(multiLocationRows.map(variantName))} {multiLocationRows.length === 1 ? 'is' : 'are'} kept in more
          than one location. OpenLinker shows the total, but you correct{' '}
          {multiLocationRows.length === 1 ? 'it' : 'them'} in {multiLocationRows[0]!.masterName}, and new orders
          don&apos;t reserve {multiLocationRows.length === 1 ? 'it' : 'them'} yet.
        </Alert>
      ) : null}

      {goneRows.length > 0 ? (
        <Alert data-testid="stock-gone-alert" tone="info" density="compact">
          {goneRows[0]!.masterName} stopped reporting {joinNames(goneRows.map(variantName))}, so{' '}
          {goneRows.length === 1 ? 'its offers were' : 'their offers were'} paused. If it was deleted on purpose,
          there is nothing else to do.
        </Alert>
      ) : null}

      {everythingEmpty ? (
        <div className="empty-state" data-testid="stock-empty">
          <h2>No stock recorded for this product yet</h2>
          <p>
            {masterName ?? 'The master'} hasn&apos;t reported stock for this product. Until it does, OpenLinker
            counts it as 0 to sell and channels show it as sold out.
          </p>
          {masterConnectionId ? (
            <div className="toolbar__group" style={{ justifyContent: 'center' }}>
              <Link
                className="button button--secondary"
                to={`/connections/${encodeURIComponent(masterConnectionId)}`}
                data-testid="stock-empty-open-connection"
              >
                Check the connection&apos;s stock sync
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      {pending ? (
        <p className="av-loading-note" data-testid="stock-loading">
          <span className="button__spinner" aria-hidden="true"></span>
          Working out what you can sell for {rows.size} variant{rows.size === 1 ? '' : 's'}…
        </p>
      ) : null}
    </div>
  );
}
