/**
 * SyncGuidePanel (#4024)
 *
 * The "How to read this" guide. A SidePanel stacked above the detail panel
 * (`elevated`), so a badge inside the detail can open its own explanation
 * without closing the detail. Esc closes only the guide.
 *
 * Opening with `focusId` expands that entry's section, scrolls it into view
 * once the panel has slid in, and flashes it.
 *
 * @module apps/web/src/features/cursors/components
 */
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { SidePanel } from '../../../shared/ui/side-panel';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { Input } from '../../../shared/ui/input';
import { interpolate, useMessages } from '../../../shared/i18n';
import { buildSyncGuide, type SyncGuideItem } from '../lib/sync-guide';

type GuideChrome = ReturnType<typeof useMessages<'cursors'>>['syncGuide'];

/** Matches the panel's slide-in, so the scroll lands after the panel is in place. */
const SCROLL_AFTER_MS = 280;

interface SyncGuidePanelProps {
  open: boolean;
  focusId: string | null;
  onOpenChange: (open: boolean) => void;
}

function highlight(text: string, q: string): ReactNode {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

function matches(item: SyncGuideItem, q: string): boolean {
  return [item.name, item.text, item.key, item.todo, item.how]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(q);
}

function GuideItem({
  item,
  q,
  focused,
  G,
}: {
  item: SyncGuideItem;
  q: string;
  focused: boolean;
  G: GuideChrome;
}): ReactElement {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focused) return undefined;
    const t = window.setTimeout(() => {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      ref.current?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    }, SCROLL_AFTER_MS);
    return () => {
      window.clearTimeout(t);
    };
  }, [focused]);
  return (
    <article
      className="sync-guide__item"
      id={`sync-guide-${item.id}`}
      ref={ref}
      data-focus={focused}
    >
      <div className="sync-guide__item-top">
        {item.badge ? (
          <StatusBadge tone={item.badge} withDot={item.badge !== 'success'}>
            {item.name}
          </StatusBadge>
        ) : (
          <span className="sync-guide__item-name">{highlight(item.name, q)}</span>
        )}
      </div>
      <p>{highlight(item.text, q)}</p>
      {item.how ? (
        <div className="sync-guide__meta">{interpolate(G.shownWhen, { how: item.how })}</div>
      ) : null}
      {item.todo ? (
        <div className="sync-guide__todo">
          <b>{G.whatToDo}</b> {item.todo}
        </div>
      ) : null}
      {item.everyMinutes || item.canStartOver ? (
        <div className="sync-guide__meta">
          {item.everyMinutes ? (
            <span>{interpolate(G.runsEvery, { n: item.everyMinutes })}</span>
          ) : null}
          {item.canStartOver ? <span>{G.canStartOver}</span> : null}
        </div>
      ) : null}
      {item.key ? <div className="sync-guide__key">{highlight(item.key, q)}</div> : null}
    </article>
  );
}

export function SyncGuidePanel({ open, focusId, onOpenChange }: SyncGuidePanelProps): ReactElement {
  const [q, setQ] = useState('');
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(new Set(['health']));
  const searchRef = useRef<HTMLInputElement>(null);
  const query = q.trim().toLowerCase();
  const G = useMessages('cursors').syncGuide;
  const guide = useMemo(() => buildSyncGuide(G), [G]);

  useEffect(() => {
    if (!open) return undefined;
    if (focusId) {
      const section = guide.find((s) => s.items.some((i) => i.id === focusId));
      if (section) setOpenSections((prev) => new Set(prev).add(section.id));
      setQ('');
      return undefined;
    }
    const t = window.setTimeout(() => searchRef.current?.focus(), SCROLL_AFTER_MS);
    return () => {
      window.clearTimeout(t);
    };
  }, [open, focusId, guide]);

  const sections = guide
    .map((s) => ({ ...s, shown: query ? s.items.filter((i) => matches(i, query)) : s.items }))
    .filter((s) => s.shown.length > 0);
  const toggle = (id: string): void => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      title={G.title}
      description={G.description}
      elevated
      width={460}
      meta={
        <Input
          ref={searchRef}
          id="sync-guide-search"
          type="search"
          className="sync-guide__search"
          aria-label={G.searchLabel}
          placeholder={G.searchPlaceholder}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
          }}
        />
      }
      footer={<p className="sync-guide__foot">{G.footer}</p>}
    >
      <div className="sync-guide">
        {!query ? (
          <div className="sync-guide__intro">
            <p>
              <strong>{G.introBookmark}</strong>
              {G.intro1}
            </p>
            <p>{G.intro2}</p>
          </div>
        ) : null}
        {sections.length === 0 ? (
          <p className="sync-guide__empty">{interpolate(G.nothingFound, { q })}</p>
        ) : (
          sections.map((s) => {
            const isOpen = Boolean(query) || openSections.has(s.id);
            return (
              <section key={s.id} className="sync-guide__section" data-open={isOpen}>
                <button
                  type="button"
                  className="card-button-reset sync-guide__section-head"
                  aria-expanded={isOpen}
                  aria-controls={`sync-guide-section-${s.id}`}
                  onClick={() => {
                    toggle(s.id);
                  }}
                >
                  <span className="sync-guide__chev" aria-hidden="true">
                    ›
                  </span>
                  <span className="sync-guide__section-title">{s.title}</span>
                  <span className="sync-guide__section-sum">
                    {query ? interpolate(G.found, { n: s.shown.length }) : s.summary}
                  </span>
                </button>
                <div className="sync-guide__section-body" id={`sync-guide-section-${s.id}`}>
                  <div className="sync-guide__section-inner">
                    <div className="sync-guide__list">
                      {s.shown.map((i) => (
                        <GuideItem
                          key={i.id}
                          item={i}
                          q={query}
                          focused={open && focusId === i.id}
                          G={G}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            );
          })
        )}
      </div>
    </SidePanel>
  );
}
