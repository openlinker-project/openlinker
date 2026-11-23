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
import { BundleLoadError } from './bundle-load-error';

export interface BundleHistoryProps {
  entries: BundleHistoryEntry[] | undefined;
  isLoading: boolean;
  isError: boolean;
  /** Re-reads the history after a failed load. */
  onRetry?: () => void;
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

interface DiffChip {
  kind: 'added' | 'removed' | 'quantity';
  text: string;
}

/** What changed from the older version to this one, by component variant. */
function diffAgainst(
  entry: BundleHistoryEntry,
  older: BundleHistoryEntry | undefined,
  texts: { added: string; removed: string; quantity: string }
): DiffChip[] {
  if (older === undefined) return [];
  const nameOf = (source: BundleHistoryEntry, index: number): string =>
    source.componentSummaries[index]?.name ?? source.components[index]?.variantId ?? '';
  const before = new Map(
    older.components.map((c, i) => [c.variantId, { qty: c.quantity, name: nameOf(older, i) }] as const)
  );
  const chips: DiffChip[] = [];
  entry.components.forEach((component, index) => {
    const name = nameOf(entry, index);
    const prev = before.get(component.variantId);
    if (prev === undefined) {
      chips.push({ kind: 'added', text: interpolate(texts.added, { name }) });
    } else if (prev.qty !== component.quantity) {
      chips.push({
        kind: 'quantity',
        text: interpolate(texts.quantity, { name, from: prev.qty, to: component.quantity }),
      });
    }
  });
  const now = new Set(entry.components.map((c) => c.variantId));
  older.components.forEach((component, index) => {
    if (!now.has(component.variantId)) {
      chips.push({ kind: 'removed', text: interpolate(texts.removed, { name: nameOf(older, index) }) });
    }
  });
  return chips;
}

export function BundleHistory({
  entries,
  isLoading,
  isError,
  onRetry,
}: BundleHistoryProps): ReactElement {
  const copy = useMessages('bundles');
  const { locale } = useLocale();
  const format = useFormat();

  if (isLoading) {
    return (
      <div className="bf-skeleton" role="status" aria-live="polite" data-testid="bundle-form-history-loading">
        <span className="sr-only">{copy.form.historyLoading}</span>
        <span className="bf-skeleton__row" aria-hidden="true" />
        <span className="bf-skeleton__row" aria-hidden="true" />
        <span className="bf-skeleton__row" aria-hidden="true" />
      </div>
    );
  }
  if (isError || entries === undefined) {
    return <BundleLoadError onRetry={onRetry ?? (() => undefined)} testId="bundle-form-history-error" />;
  }
  if (entries.length === 0) return <p className="pm-help">{copy.form.historyEmpty}</p>;

  const openOlder = entries
    .filter((entry) => !entry.current)
    .reduce((sum, entry) => sum + entry.openOrders, 0);

  return (
    <>
      <ul className="pm-log" data-testid="bundle-form-history">
        {entries.map((entry, index) => {
          const isFirst = index === entries.length - 1;
          const date = format.date(entry.createdAt);
          const chips = diffAgainst(entry, entries[index + 1], {
            added: copy.form.historyDiffAdded,
            removed: copy.form.historyDiffRemoved,
            quantity: copy.form.historyDiffQuantity,
          });
          return (
            <li
              key={entry.version}
              className={entry.current ? 'bf-history__current' : undefined}
              aria-current={entry.current ? 'true' : undefined}
              data-testid={`bundle-form-history-entry-${String(entry.version)}`}
            >
              <span>
                <b>
                  {interpolate(isFirst ? copy.form.historyCreated : copy.form.historyEntryChanged, {
                    date,
                  })}
                  {entry.current ? (
                    <span className="cx-tag bf-history__badge">{copy.form.historyCurrent}</span>
                  ) : null}
                </b>
                <span className="text-muted">{describeComponents(entry)}</span>
                {chips.length > 0 ? (
                  <span className="bf-history__chips" data-testid={`bundle-form-history-diff-${String(entry.version)}`}>
                    {chips.map((chip) => (
                      <span key={chip.text} className={`bf-history__chip bf-history__chip--${chip.kind}`}>
                        {chip.text}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
              {entry.openOrders > 0 ? (
                <span className="cx-tag cx-tag--quiet">
                  {formatPlural(entry.openOrders, copy.form.historyOpenOrders, locale)}
                </span>
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
