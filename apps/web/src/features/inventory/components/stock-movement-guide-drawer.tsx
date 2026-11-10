/**
 * Stock movement guide drawer (#4061)
 *
 * "How to read this": searchable help in a side panel, grouped in the same
 * accordion the filter sheets use. Opened from the page header or from a
 * row's "What does this mean?" link, which opens the matching section and
 * scrolls to the entry.
 *
 * @module apps/web/src/features/inventory/components
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { interpolate } from '../../../shared/i18n';
import { SidePanel } from '../../../shared/ui/side-panel';
import { FilterSection } from '../../../shared/ui/filter-sheet';
import { Input } from '../../../shared/ui/input';
import { StatusBadge } from '../../../shared/ui/status-badge';
import {
  buildStockGuide,
  guideSectionOf,
  matchesGuideQuery,
  normalizeGuideQuery,
  type GuideEntry,
} from '../lib/stock-movement-guide';
import type { StockGuideId, StockHistoryCopy } from '../lib/stock-movement-view-model';

export interface StockMovementGuideDrawerProps {
  open: boolean;
  focusId: StockGuideId | null;
  copy: StockHistoryCopy;
  onOpenChange: (open: boolean) => void;
}

function GuideItem({
  entry,
  focused,
  todoLabel,
}: {
  entry: GuideEntry;
  focused: boolean;
  todoLabel: string;
}): ReactElement {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focused) return;
    const id = window.setTimeout(() => ref.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 250);
    return () => window.clearTimeout(id);
  }, [focused]);
  return (
    <article
      ref={ref}
      className={focused ? 'stock-guide__item stock-guide__item--focus' : 'stock-guide__item'}
      data-guide-id={entry.id}
    >
      {entry.badgeTone ? (
        <StatusBadge compact tone={entry.badgeTone}>
          {entry.title}
        </StatusBadge>
      ) : (
        <h4>{entry.title}</h4>
      )}
      <p>{entry.body}</p>
      {entry.todo ? (
        <p className="stock-guide__todo">
          <strong>{todoLabel}</strong> {entry.todo}
        </p>
      ) : null}
    </article>
  );
}

export function StockMovementGuideDrawer({
  open,
  focusId,
  copy,
  onOpenChange,
}: StockMovementGuideDrawerProps): ReactElement {
  const g = copy.guide;
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (open) setQuery('');
  }, [open, focusId]);

  const q = normalizeGuideQuery(query);
  const focusSection = focusId ? guideSectionOf(focusId) : 'numbers';
  const sections = useMemo(
    () =>
      buildStockGuide(copy)
        .map((section) => ({ ...section, shown: section.entries.filter((e) => matchesGuideQuery(e, q)) }))
        .filter((section) => section.shown.length > 0),
    [copy, q],
  );

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      kicker={g.kicker}
      title={g.title}
      description={g.description}
      width={440}
      elevated
    >
      <div className="stock-guide" data-testid="stock-movement-guide">
        <Input
          type="search"
          placeholder={g.searchPlaceholder}
          aria-label={g.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {q ? null : <p className="stock-guide__intro">{g.intro}</p>}
        {sections.length === 0 ? (
          <p className="stock-guide__empty">{interpolate(g.empty, { query: query.trim() })}</p>
        ) : (
          sections.map((section) => (
            <FilterSection
              key={`${section.id}:${q ? 'q' : (focusId ?? 'none')}`}
              title={section.title}
              summary={q ? interpolate(g.found, { n: section.shown.length }) : section.summary}
              defaultOpen={Boolean(q) || section.id === focusSection}
            >
              {section.shown.map((entry) => (
                <GuideItem key={entry.id} entry={entry} focused={open && focusId === entry.id} todoLabel={g.todo} />
              ))}
            </FilterSection>
          ))
        )}
      </div>
    </SidePanel>
  );
}
