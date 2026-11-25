/**
 * SettingsPageTemplate (#4132)
 *
 * The one layout every settings screen renders through: title +
 * description, a sticky "On this page" contents on the left, one card of
 * sections on the right and the actions at the bottom. Operators find a
 * setting in the same place on every screen.
 *
 * Once the big title has scrolled away it lives on as a condensed title above
 * the sticky contents (an IntersectionObserver drives it; it is `inert` and
 * `aria-hidden` while hidden). The active contents entry follows scroll.
 *
 * `readOnly` shows the status banner and disables every control inside the
 * card through a `<fieldset disabled>`, so callers do not have to thread a
 * `disabled` prop into each field.
 *
 * Sections are plain data: a caller that has nothing to show for a section (a
 * plugin slot that resolved to no contribution) omits it from the array, so no
 * empty heading is rendered.
 *
 * @module shared/ui
 */
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useMessages } from '../i18n/use-messages';
import { StatusBadge } from './status-badge';
import { mapViewportWindow, type RailSegment } from './settings-toc-rail';

export interface SettingsPageSection {
  id: string;
  /** Short label in the contents. */
  label: string;
  title?: ReactNode;
  hint?: ReactNode;
  /** `true` renders the "New" chip; any other node is rendered as given. */
  badge?: ReactNode;
  /** `data-tour` anchor for a guided tour. */
  tour?: string;
  children: ReactNode;
}

export interface SettingsPageTemplateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Optional plain-sentence line under the condensed title; never shown in the big header. */
  eyebrow?: string;
  /** Identity mark (platform tile) shown left of the title. */
  mark?: ReactNode;
  /** Wider card for screens that hold grids instead of one form column. */
  wide?: boolean;
  /** Drops the card around the sections; for index screens made of rows. */
  plain?: boolean;
  /** One column: no "on this page" rail beside the sections. */
  singleColumn?: boolean;
  title: ReactNode;
  /** Condensed title shown above the contents once the big title scrolled away. */
  short: string;
  description?: ReactNode;
  sections: SettingsPageSection[];
  actions?: ReactNode;
  readOnly?: boolean;
}

/** Distance below the sticky topbar at which a section counts as current. */
const ACTIVE_OFFSET_PX = 120;
const FALLBACK_TOPBAR_PX = 52;

function topbarHeight(): number {
  if (typeof window === 'undefined') return FALLBACK_TOPBAR_PX;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--shell-topbar-height');
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : FALLBACK_TOPBAR_PX;
}

function scrollBehavior(): ScrollBehavior {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  return reduce ? 'auto' : 'smooth';
}

export const SettingsPageTemplate = forwardRef<HTMLDivElement, SettingsPageTemplateProps>(
  function SettingsPageTemplate(
    { eyebrow, mark, wide = false, plain = false, singleColumn = false, title, short, description, sections, actions, readOnly = false, className = '', ...rest },
    ref,
  ): ReactElement {
    const copy = useMessages('ui').settingsTemplate;
    const baseId = useId();
    const headRef = useRef<HTMLElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const markRef = useRef<HTMLSpanElement>(null);
    // Every section that is on screen, in page order. The first one is the
    // "current" entry (aria-current); the rest are marked as visible too, so
    // the contents shows the whole span a reader is looking at.
    const [visible, setVisible] = useState<readonly string[]>(sections[0] ? [sections[0].id] : []);
    const active = visible[0] ?? '';
    const [condensed, setCondensed] = useState(false);
    const sectionKey = sections.map((s) => s.id).join('|');
    const anchor = (id: string): string => `${baseId}-sec-${id}`;

    useEffect(() => {
      const el = headRef.current;
      if (!el || typeof IntersectionObserver === 'undefined') return;
      const io = new IntersectionObserver(([entry]) => setCondensed(!entry.isIntersecting), {
        rootMargin: `-${topbarHeight()}px 0px 0px 0px`,
        threshold: 0,
      });
      io.observe(el);
      return () => io.disconnect();
    }, []);

    useEffect(() => {
      const ids = sectionKey ? sectionKey.split('|') : [];
      const onScroll = (): void => {
        const top = topbarHeight() + ACTIVE_OFFSET_PX;
        const bottom = window.innerHeight;
        const inView: string[] = [];
        let lastAbove = ids[0] ?? '';
        for (const id of ids) {
          const el = document.getElementById(`${baseId}-sec-${id}`);
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          // A sliver at the edge does not count as "being looked at".
          const overlap = Math.min(rect.bottom, bottom) - Math.max(rect.top, top);
          if (overlap >= Math.min(24, rect.height / 2)) inView.push(id);
          else if (rect.top < top) lastAbove = id;
        }
        const next = inView.length > 0 ? inView : lastAbove ? [lastAbove] : [];
        setVisible((prev) =>
          prev.length === next.length && prev.every((id, i) => id === next[i]) ? prev : next
        );
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
      return () => window.removeEventListener('scroll', onScroll);
    }, [sectionKey, baseId]);

    // The marker is a continuous window onto the list: written straight to the
    // element (no React state per frame), so it tracks the scroll exactly.
    useEffect(() => {
      const list = listRef.current;
      const mark = markRef.current;
      const ids = sectionKey ? sectionKey.split('|') : [];
      if (!list || !mark || ids.length === 0) return;
      let raf = 0;
      const update = (): void => {
        raf = 0;
        const horizontal = window.matchMedia?.('(max-width: 767px)').matches ?? false;
        const links = list.querySelectorAll<HTMLElement>('.settings-page__toc-link');
        const scrollY = window.scrollY;
        const segments: RailSegment[] = [];
        ids.forEach((id, i) => {
          const el = document.getElementById(`${baseId}-sec-${id}`);
          const link = links[i];
          if (!el || !link) return;
          const rect = el.getBoundingClientRect();
          const linkStart = horizontal ? link.offsetLeft : link.offsetTop;
          segments.push({
            start: rect.top + scrollY,
            end: rect.bottom + scrollY,
            linkStart,
            linkEnd: linkStart + (horizontal ? link.offsetWidth : link.offsetHeight),
          });
        });
        const win = mapViewportWindow(segments, scrollY + topbarHeight(), scrollY + window.innerHeight);
        if (!win) return;
        mark.style.transform = horizontal
          ? `translate3d(${win.start}px,0,0)`
          : `translate3d(0,${win.start}px,0)`;
        mark.style[horizontal ? 'width' : 'height'] = `${win.size}px`;
        mark.style[horizontal ? 'height' : 'width'] = '';
        mark.style.opacity = '1';
      };
      const schedule = (): void => {
        if (!raf) raf = requestAnimationFrame(update);
      };
      update();
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule);
      const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
      ro?.observe(list);
      const card = list.closest('.settings-page')?.querySelector('.settings-page__card');
      if (card) ro?.observe(card);
      return () => {
        window.removeEventListener('scroll', schedule);
        window.removeEventListener('resize', schedule);
        ro?.disconnect();
        if (raf) cancelAnimationFrame(raf);
      };
    }, [sectionKey, baseId, visible]);

    const goTo = (id: string): void => {
      document.getElementById(anchor(id))?.scrollIntoView?.({ behavior: scrollBehavior(), block: 'start' });
    };
    const toTop = (): void => {
      window.scrollTo?.({ top: 0, behavior: scrollBehavior() });
    };

    return (
      <div
        ref={ref}
        className={['settings-page', className].filter(Boolean).join(' ')}
        data-single={singleColumn || undefined}
        {...rest}
      >
        <header className="settings-page__head" ref={headRef} data-condensed={condensed}>
          {mark ? <div className="settings-page__mark">{mark}</div> : null}
          <div className="settings-page__heading">
            <h2 className="settings-page__title">{title}</h2>
            {description ? <p className="settings-page__description">{description}</p> : null}
          </div>
        </header>
        <div className="settings-page__layout">
          <nav className="settings-page__toc" aria-label={copy.sections}>
            <div
              className="settings-page__toc-page"
              data-on={condensed}
              aria-hidden={!condensed}
              inert={!condensed}
            >
              <div>
                <button type="button" className="settings-page__toc-page-btn" onClick={toTop}>
                  <strong>{short}</strong>
                  {eyebrow ? <span>{eyebrow}</span> : null}
                </button>
              </div>
            </div>
            <span className="settings-page__toc-title">{copy.onThisPage}</span>
            <div className="settings-page__toc-list" ref={listRef}>
              <span className="settings-page__toc-mark" ref={markRef} aria-hidden="true" />
              {sections.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="settings-page__toc-link"
                  aria-current={active === s.id ? 'true' : undefined}
                  data-visible={visible.includes(s.id) ? 'true' : undefined}
                  onClick={() => goTo(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </nav>
          <div className="settings-page__card" data-wide={wide || undefined} data-plain={plain || undefined}>
            {readOnly ? (
              <div className="settings-page__readonly" role="status">
                <svg
                  viewBox="0 0 16 16"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <rect x="3" y="7" width="10" height="7" rx="1.5" />
                  <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
                </svg>
                <span>{copy.readOnly}</span>
              </div>
            ) : null}
            <fieldset className="settings-page__fields" disabled={readOnly}>
              {sections.map((s) => (
                <section
                  key={s.id}
                  className="settings-page__section"
                  id={anchor(s.id)}
                  data-tour={s.tour}
                >
                  {s.title || s.hint ? (
                    <div className="settings-page__section-head">
                      {s.title ? (
                        <h3>
                          {s.title}
                          {s.badge === true ? (
                            <StatusBadge tone="info" compact>
                              {copy.newBadge}
                            </StatusBadge>
                          ) : (
                            s.badge
                          )}
                        </h3>
                      ) : null}
                      {s.hint ? <p>{s.hint}</p> : null}
                    </div>
                  ) : null}
                  {s.children}
                </section>
              ))}
              {actions ? <div className="settings-page__actions">{actions}</div> : null}
            </fieldset>
          </div>
        </div>
      </div>
    );
  },
);
