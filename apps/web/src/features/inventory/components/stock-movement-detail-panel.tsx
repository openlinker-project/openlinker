/**
 * Stock movement detail panel (#4061)
 *
 * Opens from a row and answers, in order: what happened (one title and one
 * plain explanation), how the numbers add up, and where the change came from.
 * Raw ids sit last, folded, for support conversations. A state that asks the
 * operator to act puts its explanation in a warning callout instead.
 *
 * The panel keeps the last row while it slides out, so it never animates
 * away empty.
 *
 * @module apps/web/src/features/inventory/components
 */
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SidePanel } from '../../../shared/ui/side-panel';
import { Button } from '../../../shared/ui/button';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { InventoryMovementRow } from '../api/inventory-movements.types';
import { operatorReasonText } from '../lib/stock-movement-presentation';
import {
  describeMovement,
  explainMovement,
  guideIdFor,
  movementBadge,
  type StockGuideId,
  type StockHistoryContext,
} from '../lib/stock-movement-view-model';

export interface StockMovementDetailPanelProps {
  row: InventoryMovementRow | null;
  context: StockHistoryContext;
  onOpenChange: (open: boolean) => void;
  onExplain: (guideId: StockGuideId) => void;
  /** Narrows the list to the row's variant. Absent when the list already is. */
  onShowVariant?: (row: InventoryMovementRow) => void;
  formatTime: (iso: string) => string;
  formatDateTime: (iso: string) => string;
}

interface Fact {
  id: string;
  label: string;
  value: ReactNode;
  mono?: boolean;
}

function Facts({ items }: { items: readonly Fact[] }): ReactElement {
  return (
    <dl className="stock-facts">
      {items.map((item) => (
        <div key={item.id} className="stock-facts__row">
          <dt>{item.label}</dt>
          <dd className={item.mono ? 'mono-text' : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StockMovementDetailPanel({
  row: selectedRow,
  context,
  onOpenChange,
  onExplain,
  onShowVariant,
  formatTime,
  formatDateTime,
}: StockMovementDetailPanelProps): ReactElement {
  const [shown, setShown] = useState(selectedRow);
  useEffect(() => {
    if (selectedRow) setShown(selectedRow);
  }, [selectedRow]);
  const open = selectedRow !== null;
  const row = selectedRow ?? shown;
  const { copy } = context;
  const d = copy.detail;

  const explanation = row ? explainMovement(row, context, formatTime) : null;
  const badge = row ? movementBadge(row, copy) : null;
  const facts: Fact[] = row
    ? [
        { id: 'by', label: d.facts.by, value: describeMovement(row, context) },
        { id: 'shop', label: d.facts.shop, value: context.masterName(row) },
        { id: 'recorded', label: d.facts.recorded, value: formatDateTime(row.occurredAt) },
        ...(row.reason === 'manual_correction' && operatorReasonText(row)
          ? [{ id: 'note', label: d.facts.note, value: operatorReasonText(row) }]
          : []),
      ]
    : [];

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      kicker={row?.kind === 'reservation' ? d.kickerHold : d.kickerMovement}
      title={explanation?.title ?? ''}
      description={d.description}
      meta={
        row ? (
          <>
            <span className="stock-detail__product">
              {row.productName ?? row.productId}
              {row.sku ? <span className="mono-text"> {row.sku}</span> : null}
            </span>
            {badge ? (
              <StatusBadge compact tone={badge.tone}>
                {badge.label}
              </StatusBadge>
            ) : null}
          </>
        ) : null
      }
      footer={
        row ? (
          <>
            {onShowVariant && row.productVariantId ? (
              <Button tone="secondary" onClick={() => onShowVariant(row)} data-testid="stock-movement-show-variant">
                {d.allForSku}
              </Button>
            ) : null}
            <Link className="button button--ghost" to={`/products/${encodeURIComponent(row.productId)}`}>
              {d.openProduct}
            </Link>
          </>
        ) : null
      }
    >
      {row && explanation ? (
        <div className="stock-detail" data-testid="stock-movement-detail">
          {explanation.attention ? (
            <div className="stock-detail__callout" role="note">
              {explanation.body}
            </div>
          ) : (
            <p className="stock-detail__lead">{explanation.body}</p>
          )}
          <button type="button" className="stock-link" onClick={() => onExplain(guideIdFor(row, copy))}>
            {d.whatDoesThisMean}
          </button>

          <section className="stock-detail__section">
            <h3>{d.howNumbersAddUp}</h3>
            <dl className="stock-ledger">
              {explanation.lines.map((line) => (
                <div
                  key={line.label}
                  className={line.total ? 'stock-ledger__row stock-ledger__row--total' : 'stock-ledger__row'}
                >
                  <dt>{line.label}</dt>
                  <dd className="tabular">{line.value}</dd>
                </div>
              ))}
            </dl>
            <p className="stock-detail__footnote">{explanation.footnote}</p>
          </section>

          <section className="stock-detail__section">
            <h3>{d.facts.title}</h3>
            <Facts items={facts} />
          </section>

          <details className="stock-detail__tech">
            <summary>{d.tech.title}</summary>
            <Facts
              items={[
                { id: 'id', label: d.tech.id, value: row.id, mono: true },
                { id: 'status', label: d.tech.status, value: row.status, mono: true },
                { id: 'reason', label: d.tech.reason, value: row.reason ?? row.kind, mono: true },
                { id: 'ref', label: d.tech.ref, value: row.sourceRef ?? '-', mono: true },
                { id: 'variant', label: d.tech.variant, value: row.productVariantId ?? '-', mono: true },
              ]}
            />
          </details>
        </div>
      ) : null}
    </SidePanel>
  );
}
