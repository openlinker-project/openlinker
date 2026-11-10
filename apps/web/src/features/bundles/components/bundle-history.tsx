/**
 * Bundle history (#3624, restyled #3520)
 *
 * Earlier versions of a bundle's composition, newest first, each with the
 * number of open orders that still ship with it. Rendered inside a composer
 * section, so it carries no card chrome of its own.
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

  if (isLoading) return <p className="pm-help">{copy.form.saving}</p>;
  if (isError || entries === undefined) return <p role="alert">{copy.form.loadFailed}</p>;
  if (entries.length === 0) return <p className="pm-help">{copy.form.historyEmpty}</p>;

  const openOlder = entries.filter((entry) => !entry.current).reduce((sum, entry) => sum + entry.openOrders, 0);

  return (
    <>
      <ul className="pm-log" data-testid="bundle-form-history">
        {entries.map((entry, index) => {
          const isFirst = index === entries.length - 1;
          const date = format.date(entry.createdAt);
          return (
            <li key={entry.version} data-testid={`bundle-form-history-entry-${String(entry.version)}`}>
              <span>
                <b>{interpolate(isFirst ? copy.form.historyCreated : copy.form.historyEntryChanged, { date })}</b>
                <span className="text-muted">{describeComponents(entry)}</span>
              </span>
              {entry.openOrders > 0 ? (
                <span className="cx-tag cx-tag--quiet">{formatPlural(entry.openOrders, copy.form.historyOpenOrders, locale)}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {openOlder > 0 ? (
        <div className="cx-note">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16v.5" />
          </svg>
          <p>{formatPlural(openOlder, copy.form.openOrdersNote, locale)}</p>
        </div>
      ) : null}
    </>
  );
}
