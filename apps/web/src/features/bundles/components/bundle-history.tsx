/**
 * Bundle history tab (#3624)
 *
 * When the composition changed and what changed, newest first, with how many
 * open orders still ship an older composition. The version numbers are not
 * shown: an operator decides nothing by them, the freezing is automatic.
 *
 * @module apps/web/src/features/bundles/components
 */
import type { ReactElement } from 'react';
import { formatPlural, interpolate, useFormat, useLocale, useMessages } from '../../../shared/i18n';
import type { BundleHistoryEntry } from '../api/bundles.types';

export interface BundleHistoryProps {
  entries: BundleHistoryEntry[] | undefined;
  isLoading: boolean;
  isError: boolean;
  currency?: string;
}

function describeComponents(entry: BundleHistoryEntry): string {
  return entry.components
    .map((component, index) => {
      const name = entry.componentSummaries[index]?.name ?? component.variantId;
      return component.quantity > 1 ? `${String(component.quantity)} x ${name}` : name;
    })
    .join(', ');
}

export function BundleHistory({ entries, isLoading, isError }: BundleHistoryProps): ReactElement {
  const copy = useMessages('bundles');
  const { locale } = useLocale();
  const format = useFormat();

  if (isLoading) return <p className="text-muted">{copy.form.saving}</p>;
  if (isError || entries === undefined) return <p role="alert">{copy.form.loadFailed}</p>;
  if (entries.length === 0) return <p className="text-muted">{copy.form.historyEmpty}</p>;

  return (
    <section className="detail-card">
      <div className="detail-card__head">
        <h3 className="detail-card__title">{copy.form.historyTitle}</h3>
      </div>
      <ul data-testid="bundle-form-history" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {entries.map((entry, index) => {
          const isFirst = index === entries.length - 1;
          const date = format.date(entry.createdAt);
          return (
            <li key={entry.version} data-testid={`bundle-form-history-entry-${String(entry.version)}`}>
              <p>
                {interpolate(isFirst ? copy.form.historyCreated : copy.form.historyEntryChanged, { date })}
              </p>
              <p className="text-muted">{describeComponents(entry)}</p>
              {entry.openOrders > 0 ? (
                <p className="text-muted">
                  {formatPlural(entry.openOrders, copy.form.historyOpenOrders, locale)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
