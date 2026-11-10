/**
 * PromotionsTable (#3935, mockup `promotions-list` table)
 *
 * The promotions in the order they are checked: the position with arrows to move
 * a row, the name and its condition, the gift, the channels as chips, the state,
 * the usage bar against the piece limit, an on/off switch, Edit and a row menu.
 * Reordering slides the rows (see `useFlipRows`) and is only offered when the
 * list is showing every promotion in order, because moving a row inside a
 * filtered view would not say where it lands.
 *
 * @module apps/web/src/features/promotions/components
 */
import { useMemo, useRef, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { interpolate, useMessages } from '../../../shared/i18n';
import { formatAbsoluteDate as formatDate } from '../../../shared/format/format-date';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import { HelpHint } from '../../../shared/ui/help-hint';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { Toggle } from '../../../shared/ui/toggle';
import type { Connection } from '../../connections';
import { useVariantSummaries } from '../../gifts';
import type { Promotion } from '../api/promotions.types';
import { useFlipRows } from '../hooks/use-flip-rows';
import { combineChip, conditionText } from '../lib/promotion-text';
import {
  PROMOTION_STATE_TONE,
  movedOrder,
  promotionChannelIds,
  promotionStateKey,
  promotionUsage,
} from '../lib/promotion-view';
import { PromotionChannelChip } from './promotion-channel-chip';
import { PromotionRowMenu } from './promotion-row-menu';
import { PromotionThumb } from './promotion-thumb';

export interface PromotionsTableProps {
  /** The rows to show, in check order. */
  rows: Promotion[];
  /** Every promotion in check order (the ids a move is computed over). */
  allIds: readonly string[];
  connections: readonly Connection[];
  connectionsLoading: boolean;
  canWrite: boolean;
  /** Offer the move arrows: the list shows everything in order. */
  canReorder: boolean;
  moving: boolean;
  peekId: string | null;
  onPeek: (promotion: Promotion) => void;
  onReorder: (ids: string[]) => void;
  onSetActive: (promotion: Promotion, active: boolean) => void;
  onDuplicate: (promotion: Promotion) => void;
  onDelete: (promotion: Promotion) => void;
}

export function useRowTexts(rows: readonly Promotion[]): {
  summaries: ReturnType<typeof useVariantSummaries>;
  nameOf: (variantId: string) => string;
} {
  const ids = useMemo(
    () =>
      rows.flatMap((p) => [
        p.benefit.variantId,
        ...p.conditions.flatMap((c) => (c.field === 'containsProduct' ? [c.value] : [])),
      ]),
    [rows],
  );
  const summaries = useVariantSummaries(ids);
  return { summaries, nameOf: (variantId) => summaries.get(variantId)?.name ?? '…' };
}

export function PromotionsTable({
  rows,
  allIds,
  connections,
  connectionsLoading,
  canWrite,
  canReorder,
  moving,
  peekId,
  onPeek,
  onReorder,
  onSetActive,
  onDuplicate,
  onDelete,
}: PromotionsTableProps): ReactElement {
  const copy = useMessages('promotions');
  const { summaries, nameOf } = useRowTexts(rows);
  const wrap = useRef<HTMLDivElement>(null);
  useFlipRows(wrap, rows.map((p) => p.id).join('|'));

  const byId = useMemo(() => new Map(connections.map((c) => [c.id, c])), [connections]);
  const channelsOf = (promotion: Promotion): Connection[] => {
    const ids = promotionChannelIds(promotion);
    const all = connections.filter((c) => c.enabledCapabilities.includes('OrderSource'));
    return ids.length === 0 ? all : ids.map((id) => byId.get(id)).filter((c): c is Connection => c !== undefined);
  };

  const move = (promotion: Promotion, direction: 'up' | 'down'): void => {
    const next = movedOrder(allIds, promotion.id, direction);
    if (next !== null) onReorder(next);
  };

  const stateNote = (promotion: Promotion): string => {
    const key = promotionStateKey(promotion);
    if (key === 'pausedStock') return copy.row.pausedStock;
    if (key === 'pausedLimit') {
      return interpolate(copy.row.pausedLimit, {
        given: String(promotion.unitsGiven),
        cap: String(promotion.effectiveCap ?? promotion.unitsGiven),
      });
    }
    if (key === 'scheduled') return interpolate(copy.row.starts, { date: formatDate(promotion.effectiveFrom) });
    return promotion.effectiveTo === null
      ? copy.row.noEnd
      : interpolate(copy.row.until, { date: formatDate(promotion.effectiveTo) });
  };

  const usageNode = (promotion: Promotion): ReactElement => {
    const usage = promotionUsage(promotion);
    return (
      <span className="orders-cell-stack pm-use">
        <span className="pm-use__row">
          <span className="mono tabular">
            {usage.cap === null
              ? interpolate(copy.table.pcsNoCap, { given: String(usage.given) })
              : interpolate(copy.table.pcs, { given: String(usage.given), cap: String(usage.cap) })}
          </span>
          {usage.percent !== null ? <span className="pm-use__pct mono tabular">{usage.percent}%</span> : null}
        </span>
        {usage.percent !== null ? (
          <span
            className={['pm-bar', usage.full ? 'pm-bar--full' : ''].filter(Boolean).join(' ')}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={usage.percent}
            aria-label={copy.table.usageAria}
          >
            <i style={{ width: `${usage.percent}%` }} />
          </span>
        ) : null}
      </span>
    );
  };

  const rowCopy = {
    basket: copy.row.basket,
    contains: copy.row.contains,
    perUnit: copy.row.perUnit,
    onlySelected: copy.row.onlySelected,
    noCombine: copy.row.noCombine,
  };

  const nameCell = (promotion: Promotion): ReactElement => {
    const chip = combineChip(promotion, rowCopy);
    return (
      <span className="orders-cell-stack">
        <span className="pm-name">
          <Link
            to={`/promotions/${encodeURIComponent(promotion.id)}`}
            className="pm-name__link"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            {promotion.name}
          </Link>
          {chip !== null ? <span className="chip">{chip}</span> : null}
        </span>
        <span className="text-muted orders-cell-sub">{conditionText(promotion, rowCopy, nameOf)}</span>
      </span>
    );
  };

  const benefitCell = (promotion: Promotion): ReactElement => {
    const summary = summaries.get(promotion.benefit.variantId);
    return (
      <span className="pm-benefit">
        <PromotionThumb
          seed={promotion.benefit.productId}
          name={summary?.name ?? promotion.name}
          imageSrc={summary?.imageSrc}
        />
        <span className="orders-cell-stack">
          <span>{summary?.name ?? '…'}</span>
          <span className="text-muted orders-cell-sub">
            {interpolate(copy.row.gift, { n: String(promotion.benefit.quantity) })}
          </span>
        </span>
      </span>
    );
  };

  const stateCell = (promotion: Promotion): ReactElement => {
    const key = promotionStateKey(promotion);
    return (
      <span className="orders-cell-stack">
        <StatusBadge tone={PROMOTION_STATE_TONE[key]} withDot compact>
          {copy.status[key]}
        </StatusBadge>
        <span className="text-muted orders-cell-sub">{stateNote(promotion)}</span>
      </span>
    );
  };

  const channelsCell = (promotion: Promotion): ReactElement => (
    <span className="pm-chans">
      {promotionChannelIds(promotion).length === 0 ? (
        <span className="chip" data-testid="promotion-all-channels">
          {copy.row.allChannels}
        </span>
      ) : (
        channelsOf(promotion).map((channel) => (
          <PromotionChannelChip key={channel.id} connection={channel} link loading={connectionsLoading} />
        ))
      )}
    </span>
  );

  const columns: DataTableColumn<Promotion>[] = [
    {
      id: 'order',
      width: '7.25rem',
      header: (
        <span className="pm-th">
          {copy.columns.order}
          <HelpHint guide="g-order" label={copy.table.help.order} />
        </span>
      ),
      cell: (promotion): ReactElement => {
        const index = allIds.indexOf(promotion.id);
        return (
          <span className="pm-order">
            {canWrite && canReorder ? (
              <span className="pm-grip" aria-hidden="true">
                <i /> <i /> <i /> <i /> <i /> <i />
              </span>
            ) : null}
            <span className="mono tabular pm-n">{promotion.position}</span>
            {canWrite && canReorder ? (
              <span className="pm-move">
                <button
                  type="button"
                  className="pm-mv"
                  title={copy.table.moveUp}
                  disabled={moving || index <= 0}
                  aria-label={interpolate(copy.table.moveUpAria, { name: promotion.name })}
                  onClick={(event) => {
                    event.stopPropagation();
                    move(promotion, 'up');
                  }}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M4 10l4-4 4 4" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="pm-mv"
                  title={copy.table.moveDown}
                  disabled={moving || index === allIds.length - 1}
                  aria-label={interpolate(copy.table.moveDownAria, { name: promotion.name })}
                  onClick={(event) => {
                    event.stopPropagation();
                    move(promotion, 'down');
                  }}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                </button>
              </span>
            ) : null}
          </span>
        );
      },
    },
    { id: 'promotion', width: '20%', lines: 2, header: copy.columns.promotion, cell: nameCell },
    { id: 'benefit', width: '16%', lines: 2, header: copy.columns.benefit, cell: benefitCell },
    { id: 'channels', width: '14%', header: copy.columns.channels, cell: channelsCell, hideBelow: 1024 },
    { id: 'state', width: '11%', lines: 2, header: copy.columns.state, cell: stateCell },
    {
      id: 'usage',
      width: '15%',
      lines: 2,
      header: (
        <span className="pm-th">
          {copy.columns.usage}
          <HelpHint guide="g-limit" label={copy.table.help.usage} />
        </span>
      ),
      cell: usageNode,
      hideBelow: 768,
    },
    {
      id: 'actions',
      width: '14rem',
      align: 'right',
      header: <span className="sr-only">{copy.columns.actions}</span>,
      cell: (promotion): ReactElement => {
        const key = promotionStateKey(promotion);
        const paused = key === 'pausedStock' || key === 'pausedLimit';
        return (
          <span className="tl-actions">
            {key === 'ended' ? (
              <span className="text-muted">{copy.table.endedLabel}</span>
            ) : (
              <Toggle
                checked={key === 'active' || key === 'scheduled'}
                disabled={!canWrite || paused}
                aria-label={interpolate(copy.table.toggleAria, { name: promotion.name })}
                srLabel={copy.table.on}
                onChange={(next) => {
                  onSetActive(promotion, next);
                }}
                data-testid={`promotion-toggle-${promotion.id}`}
              />
            )}
            <Link
              className="button button--secondary button--sm"
              to={`/promotions/${encodeURIComponent(promotion.id)}`}
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              {copy.table.edit}
            </Link>
            <PromotionRowMenu
              promotion={promotion}
              canWrite={canWrite}
              canReorder={canReorder}
              isFirst={allIds.indexOf(promotion.id) <= 0}
              isLast={allIds.indexOf(promotion.id) === allIds.length - 1}
              onMove={(direction) => {
                move(promotion, direction);
              }}
              onDuplicate={() => {
                onDuplicate(promotion);
              }}
              onSetActive={(active) => {
                onSetActive(promotion, active);
              }}
              onDelete={() => {
                onDelete(promotion);
              }}
            />
          </span>
        );
      },
    },
  ];

  return (
    <div ref={wrap} className="pm-table-wrap" data-testid="promotions-table">
      <DataTable
        caption={copy.table.caption}
        columns={columns}
        rows={rows}
        rowKey={(promotion) => promotion.id}
        className="orders-table pm-dt list-table--fixed list-table--peek"
        onRowClick={onPeek}
        rowClassName={(promotion) =>
          ['pm-row', promotion.id === peekId ? 'list-row--peek' : '', !promotion.isActive ? 'pm-row--off' : '', promotion.status === 'ended' ? 'pm-row--ended' : '']
            .filter(Boolean)
            .join(' ')
        }
        rowAttributes={(promotion) => ({ 'data-id': promotion.id })}
        rowTestId={(promotion) => `promotion-row-${promotion.id}`}
        cardView={{
          title: (promotion) => <span className="pm-name">{promotion.name}</span>,
          subtitle: (promotion) => conditionText(promotion, rowCopy, nameOf),
          meta: stateCell,
          summary: (promotion) => (
            <dl className="pm-facts">
              <div>
                <dt>{copy.table.facts.benefit}</dt>
                <dd className="pm-benefit">{benefitCell(promotion)}</dd>
              </div>
              <div>
                <dt>{copy.table.facts.channels}</dt>
                <dd>{channelsCell(promotion)}</dd>
              </div>
              <div>
                <dt>{copy.table.facts.usage}</dt>
                <dd>{usageNode(promotion)}</dd>
              </div>
            </dl>
          ),
          actions: (promotion) => (
            <span className="tl-actions">
              <Link className="button button--secondary button--sm" to={`/promotions/${encodeURIComponent(promotion.id)}`}>
                {copy.table.edit}
              </Link>
            </span>
          ),
        }}
      />
    </div>
  );
}
