/**
 * Buyer Data Impact (#4289)
 *
 * "How many orders does this touch", read from the trial-run endpoint as the
 * rules change. Loading, a failed read and a connection with no orders each
 * say so; none of them is shown as a zero.
 *
 * @module apps/web/src/features/buyer-data/components
 */
import type { ReactElement } from 'react';
import { useMessages, usePlural, useFormat } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { MetricCard } from '../../../shared/ui/metric-card';
import type { BuyerDataPreview, BuyerDataRules } from '../api/buyer-data.types';

export interface BuyerDataImpactProps {
  rules: BuyerDataRules;
  preview: BuyerDataPreview | undefined;
  isLoading: boolean;
  isError: boolean;
  /** The rules are not valid, so no count is being asked for. */
  isInvalid: boolean;
}

export function BuyerDataImpact({
  rules,
  preview,
  isLoading,
  isError,
  isInvalid,
}: BuyerDataImpactProps): ReactElement | null {
  const copy = useMessages('buyer-data').impact;
  const plural = usePlural();
  const format = useFormat();

  if (isInvalid) return null;
  if (isError && preview === undefined) {
    return <Alert tone="error">{copy.error}</Alert>;
  }
  if (preview === undefined) {
    return isLoading ? <p className="muted-text">{copy.loading}</p> : null;
  }
  if (preview.totalOrders === 0) return <p className="muted-text">{copy.empty}</p>;

  const stays = Math.max(0, preview.totalOrders - (rules.hideAfterDays > 0 ? preview.toHide : 0));
  return (
    <div data-testid="buyer-data-impact" aria-busy={isLoading}>
      <div className="kpi-grid">
        <MetricCard
          label={plural(stays, copy.stays, { n: stays })}
          value={format.number(stays)}
          tone="neutral"
        />
        {rules.hideAfterDays > 0 ? (
          <MetricCard
            label={plural(preview.toHide, copy.hides, { n: preview.toHide })}
            value={format.number(preview.toHide)}
            tone="neutral"
          />
        ) : null}
        {rules.eraseAfterDays > 0 ? (
          <MetricCard
            label={plural(
              preview.toErase,
              rules.mode === 'whole-order' ? copy.erasesWhole : copy.erases,
              { n: preview.toErase }
            )}
            value={format.number(preview.toErase)}
            tone="neutral"
          />
        ) : null}
      </div>
      {preview.skippedProtected > 0 ? (
        <p className="muted-text">
          {plural(preview.skippedProtected, copy.skipped, { n: preview.skippedProtected })}
        </p>
      ) : null}
    </div>
  );
}
