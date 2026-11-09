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
import { interpolate, renderRich, useFormat, useMessages, usePlural } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { TimeDisplay } from '../../../shared/ui/time-display';
import type { StockView, StockViewVariant } from '../api/inventory.types';
import { useConnectionNames } from '../hooks/use-connection-names';
import { formatStalenessDuration } from '../lib/stock-view';
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

export function StockAlerts({
  rows,
  view,
  restricted,
  pending,
  canAdjust,
  onRetry,
  masterConnectionId = null,
}: StockAlertsProps): ReactElement | null {
  const copy = useMessages('inventory').stockAlerts;
  const plural = usePlural();
  const format = useFormat();
  const joinNames = (names: readonly string[]): string => format.list(names);
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
          {copy.viewerNotice}
        </Alert>
      ) : null}

      {restricted ? (
        <Alert data-testid="stock-restricted-notice" tone="info" title={copy.restricted.title}>
          {copy.restricted.body}
        </Alert>
      ) : null}

      {anyUnknown ? (
        <Alert
          data-testid="stock-unknown-alert"
          tone="warning"
          title={copy.unknown.title}
          action={
            <Button tone="secondary" data-testid="stock-retry" onClick={onRetry}>
              {copy.unknown.retry}
            </Button>
          }
        >
          {copy.unknown.body}
        </Alert>
      ) : null}

      {view && staleVariants.length > 0 && oldestStale ? (
        <Alert
          data-testid="stock-stale-alert"
          tone="warning"
          title={
            oldestStale.stalenessMs !== null
              ? interpolate(copy.stale.titleFor, { duration: formatStalenessDuration(oldestStale.stalenessMs) })
              : copy.stale.titleRecently
          }
          action={
            staleConnection ? (
              <Link
                className="button button--secondary"
                to={`/connections/${encodeURIComponent(staleConnection)}`}
                data-testid="stock-stale-open-connection"
              >
                {copy.stale.openConnection}
              </Link>
            ) : undefined
          }
        >
          {oldestStale.observedAt ? (
            <>
              {renderRich(
                copy.stale.lastAnswered,
                { time: () => <TimeDisplay iso={oldestStale.observedAt ?? ''} /> },
                { shop: staleConnectionName ?? copy.stale.theShop },
              )}{' '}
            </>
          ) : null}
          {interpolate(copy.stale.body, { hours: view.staleSyncThreshold.hours })}
        </Alert>
      ) : null}

      {multiSourceRows.length > 0 ? (
        <Alert data-testid="stock-multi-source-alert" tone="warning" density="compact">
          {plural(multiSourceRows.length, copy.multiSource.body, {
            variants: joinNames(multiSourceRows.map(variantName)),
            sources: joinNames([...new Set(multiSourceRows.flatMap((row) => row.sourceNames))]),
          })}{' '}
          <Link to="/connections">{copy.multiSource.link}</Link>
        </Alert>
      ) : null}

      {multiLocationRows.length > 0 ? (
        <Alert data-testid="stock-multi-location-alert" tone="info" density="compact">
          {plural(multiLocationRows.length, copy.multiLocation, {
            variants: joinNames(multiLocationRows.map(variantName)),
            master: multiLocationRows[0]!.masterName,
          })}
        </Alert>
      ) : null}

      {goneRows.length > 0 ? (
        <Alert data-testid="stock-gone-alert" tone="info" density="compact">
          {plural(goneRows.length, copy.gone, {
            master: goneRows[0]!.masterName,
            variants: joinNames(goneRows.map(variantName)),
          })}
        </Alert>
      ) : null}

      {everythingEmpty ? (
        <div className="empty-state" data-testid="stock-empty">
          <h2>{copy.empty.title}</h2>
          <p>{interpolate(copy.empty.body, { master: masterName ?? copy.empty.theMaster })}</p>
          {masterConnectionId ? (
            <div className="toolbar__group" style={{ justifyContent: 'center' }}>
              <Link
                className="button button--secondary"
                to={`/connections/${encodeURIComponent(masterConnectionId)}`}
                data-testid="stock-empty-open-connection"
              >
                {copy.empty.checkSync}
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      {pending ? (
        <p className="av-loading-note" data-testid="stock-loading">
          <span className="button__spinner" aria-hidden="true"></span>
          {plural(rows.size, copy.loading)}
        </p>
      ) : null}
    </div>
  );
}
