/**
 * Stock cell (#3569, mockup m25)
 *
 * The "Stock" column of the product page's variants table, and the same figures
 * on the mobile card: how many OpenLinker will sell, a badge that says what
 * that means, and - only when something is reserved - the count in the shop
 * behind it.
 *
 * Master figures render at once from the page's own inventory read. What you
 * can sell waits for the stock view and shows a bar meanwhile. A `null` is never
 * drawn as 0: it reads a dash with a "Not known" badge.
 *
 * @module apps/web/src/features/inventory/components
 */
import type { ReactElement, ReactNode } from 'react';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { STOCK_STATUS_LABEL } from '../../products';
import { deriveRowStatus, UNNAMED_MASTER, type StockRowModel, type StockRowStatus } from '../lib/stock-row';

const BADGE_TONE: Record<StockRowStatus['kind'], StatusBadgeTone> = {
  'in-stock': 'success',
  'low-stock': 'warning',
  'out-of-stock': 'error',
  short: 'error',
  'not-known': 'warning',
  missing: 'neutral',
};

function badgeLabel(status: StockRowStatus, masterName: string): string {
  switch (status.kind) {
    case 'short':
      return `Short by ${status.by}`;
    case 'not-known':
      return 'Not known';
    case 'missing':
      return `Missing in ${masterName}`;
    default:
      return STOCK_STATUS_LABEL[status.kind];
  }
}

function valueClass(status: StockRowStatus): string {
  const base = 'variant-stock-table__stock-value';
  if (status.kind === 'short' || status.kind === 'out-of-stock') return `${base} stock-cell--error`;
  if (status.kind === 'low-stock') return `${base} stock-cell--warning`;
  return base;
}

export function StockCell({ row }: { row: StockRowModel }): ReactElement {
  const { key, state, stock } = row;
  const masterLabel = row.masterName === UNNAMED_MASTER ? 'the master' : row.masterName;
  const masterNote = (extra?: ReactNode): ReactElement => (
    <span className="variant-stock-table__stock-note">
      <span data-testid={`stock-master-${key}`}>
        {row.masterAvailable} in {masterLabel}
      </span>
      {extra}
    </span>
  );

  if (state === 'loading') {
    return (
      <span className="variant-stock-table__stock-cell">
        <span className="variant-stock-table__stock">
          <span
            className="data-table-skeleton__bar av-skel"
            style={{ width: '4.5rem' }}
            aria-hidden="true"
            data-testid={`stock-atp-${key}`}
          ></span>
          <span className="sr-only">Loading stock</span>
        </span>
        {masterNote()}
      </span>
    );
  }

  if (state === 'restricted') {
    return (
      <span className="variant-stock-table__stock-cell">
        <span className="variant-stock-table__stock">
          <span className="variant-stock-table__stock-line">
            <span className="variant-stock-table__stock-value" data-testid={`stock-atp-${key}`}>
              {row.masterAvailable}
            </span>{' '}
            <span className="variant-stock-table__stock-label">in {masterLabel}</span>
          </span>
        </span>
      </span>
    );
  }

  const status = deriveRowStatus(row);
  const badge = (
    <StatusBadge tone={BADGE_TONE[status.kind]} compact withDot>
      {badgeLabel(status, masterLabel)}
    </StatusBadge>
  );

  if (state === 'unknown' || stock === null || stock.availableToPromise === null) {
    return (
      <span className="variant-stock-table__stock-cell">
        <span className="variant-stock-table__stock">
          <span className="variant-stock-table__stock-value" data-testid={`stock-atp-${key}`}>
            —
          </span>
          {badge}
        </span>
        {masterNote()}
      </span>
    );
  }

  const reserved = stock.heldCounted ?? 0;
  const showNote = reserved > 0 || row.multiSource;
  return (
    <span className="variant-stock-table__stock-cell">
      <span className="variant-stock-table__stock">
        <span className="variant-stock-table__stock-line">
          <span className={valueClass(status)} data-testid={`stock-atp-${key}`}>
            {stock.availableToPromise}
          </span>{' '}
          <span className="variant-stock-table__stock-label">to sell</span>
        </span>
        {badge}
      </span>
      {showNote
        ? masterNote(
            reserved > 0 ? (
              <>
                {' · '}
                <span data-testid={`stock-held-${key}`}>{reserved} reserved</span>
              </>
            ) : null,
          )
        : null}
    </span>
  );
}
