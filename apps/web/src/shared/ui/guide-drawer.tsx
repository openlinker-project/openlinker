/**
 * GuideDrawer (#3935)
 *
 * A short guide that opens from the right (a bottom sheet on phones) over the
 * page it explains: sections that open like an accordion, each holding named
 * entries. `GuideProvider` owns the open state and the `?` shortcut; a page
 * hands it the content, and `HelpHint` / `useGuide` open it at one entry, which
 * is scrolled into view and briefly highlighted.
 *
 * It is modal: the page behind is made inert while it is open, Escape closes it,
 * and focus returns to where it came from. Motion is a transition, so reduced
 * motion removes it without a separate path.
 *
 * @module shared/ui
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useMessages } from '../i18n/use-messages';

export interface GuideItem {
  id: string;
  name: string;
  /** A small tag beside the name, e.g. a default. */
  chip?: ReactNode;
  body: ReactNode;
}

export interface GuideSection {
  id: string;
  /** "01". */
  number: string;
  title: string;
  /** One short phrase shown while the section is closed. */
  summary?: string;
  items: readonly GuideItem[];
  /** Extra content under the entries, e.g. a worked example. */
  extra?: ReactNode;
}

export interface GuideContent {
  eyebrow: string;
  title: string;
  lede: string;
  closeLabel: string;
  /** The footer line; may carry `<kbd>` hints. */
  footer: ReactNode;
  sections: readonly GuideSection[];
  /** Sections open before an entry is asked for. */
  defaultOpen?: readonly string[];
}

type OpenGuide = (entryId?: string | null) => void;

const GuideContext = createContext<OpenGuide | null>(null);

/** Opens the guide, optionally at an entry. `null` outside a `GuideProvider`. */
export function useGuide(): OpenGuide | null {
  return useContext(GuideContext);
}

/** The page-header button that opens the guide; nothing outside a `GuideProvider`. */
export function GuideButton({
  label,
  'data-testid': testId,
}: {
  label: string;
  'data-testid'?: string;
}): ReactElement | null {
  const openGuide = useGuide();
  if (openGuide === null) return null;
  return (
    <button
      type="button"
      className="button button--secondary button--sm pm-helpbtn"
      data-testid={testId}
      onClick={() => {
        openGuide(null);
      }}
    >
      <span className="pm-qmark" aria-hidden="true">
        ?
      </span>
      {label}
      <span className="button__shortcut" aria-hidden="true">
        ?
      </span>
    </button>
  );
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

const reduced = (): boolean =>
  typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

export interface GuideProviderProps {
  content: GuideContent;
  children: ReactNode;
}

export function GuideProvider({ content, children }: GuideProviderProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(
    () => new Set(content.defaultOpen ?? []),
  );
  const [focused, setFocused] = useState<string | null>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const dragStart = useRef<{ y: number; t: number } | null>(null);

  const openGuide = useCallback<OpenGuide>(
    (entryId) => {
      lastFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (entryId) {
        const section = content.sections.find((s) => s.items.some((i) => i.id === entryId));
        if (section) setOpenSections(new Set([section.id]));
      }
      setFocused(entryId ?? null);
      setOpen(true);
    },
    [content.sections],
  );

  const close = useCallback((): void => {
    setOpen(false);
    setFocused(null);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === '?' && !isTyping(event.target) && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        openGuide(null);
      }
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [openGuide, close]);

  // The page behind is inert while the drawer is open; focus moves in and back out.
  useEffect(() => {
    const root = document.getElementById('root');
    if (!open) return undefined;
    root?.setAttribute('inert', '');
    document.body.classList.add('pm-guide-open');
    const timer = window.setTimeout(
      () => {
        closeRef.current?.focus({ preventScroll: true });
        if (focused !== null) {
          drawerRef.current
            ?.querySelector(`[id="${CSS.escape(focused)}"]`)
            ?.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
        }
      },
      reduced() ? 0 : 320,
    );
    return () => {
      window.clearTimeout(timer);
      root?.removeAttribute('inert');
      document.body.classList.remove('pm-guide-open');
      lastFocus.current?.focus({ preventScroll: true });
    };
  }, [open, focused]);

  const toggleSection = (id: string): void => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // A bottom sheet on phones: drag the handle or head down to dismiss.
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!window.matchMedia?.('(max-width: 640px)').matches) return;
    if ((event.target as HTMLElement).closest('button,a,input')) return;
    dragStart.current = { y: event.clientY, t: performance.now() };
    drawerRef.current?.setAttribute('data-dragging', 'true');
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const start = dragStart.current;
    if (!start) return;
    const dy = event.clientY - start.y;
    drawerRef.current?.style.setProperty('--drag', `${dy > 0 ? dy : dy * 0.06}px`);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLElement>): void => {
    const start = dragStart.current;
    if (!start) return;
    dragStart.current = null;
    const dy = event.clientY - start.y;
    const velocity = (dy / Math.max(1, performance.now() - start.t)) * 1000;
    drawerRef.current?.setAttribute('data-dragging', 'false');
    drawerRef.current?.style.setProperty('--drag', '0px');
    if (dy > (drawerRef.current?.offsetHeight ?? 0) * 0.3 || velocity > 450) close();
  };

  const value = useMemo(() => openGuide, [openGuide]);

  return (
    <GuideContext.Provider value={value}>
      {children}
      {createPortal(
        <>
          <div
            className="pm-guide-scrim"
            data-open={open ? 'true' : 'false'}
            onClick={close}
            aria-hidden="true"
          />
          <aside
            ref={drawerRef}
            className="pm-guide"
            data-open={open ? 'true' : 'false'}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pm-guide-title"
            aria-hidden={open ? undefined : 'true'}
          >
            <div
              className="pm-guide__handle"
              aria-hidden="true"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <span />
            </div>
            <div
              className="pm-guide__head"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <div className="pm-guide__top">
                <span className="eyebrow">{content.eyebrow}</span>
                <button
                  ref={closeRef}
                  type="button"
                  className="button button--ghost button--sm pm-guide__close"
                  aria-label={content.closeLabel}
                  tabIndex={open ? 0 : -1}
                  onClick={close}
                >
                  {content.closeLabel}
                </button>
              </div>
              <h2 className="pm-guide__title" id="pm-guide-title">
                {content.title}
              </h2>
              <p className="pm-guide__lede">{content.lede}</p>
            </div>
            <div className="pm-guide__body">
              {content.sections.map((section) => {
                const isOpen = openSections.has(section.id);
                return (
                  <section
                    key={section.id}
                    className="pm-gsec"
                    data-open={isOpen ? 'true' : 'false'}
                    id={section.id}
                  >
                    <button
                      type="button"
                      className="pm-gsec__head"
                      aria-expanded={isOpen}
                      aria-controls={`${section.id}-b`}
                      tabIndex={open ? 0 : -1}
                      onClick={() => {
                        toggleSection(section.id);
                      }}
                    >
                      <span className="pm-gsec__n">{section.number}</span>
                      <span className="pm-gsec__t">{section.title}</span>
                      {section.summary ? <span className="pm-gsec__sum">{section.summary}</span> : null}
                      <span className="pm-gsec__chev" aria-hidden="true" />
                    </button>
                    <div className="pm-gsec__body" id={`${section.id}-b`}>
                      <div className="pm-gsec__inner">
                        <div className="pm-gsec__list">
                          {section.items.map((item) => (
                            <div
                              key={item.id}
                              className="pm-gitem"
                              id={item.id}
                              data-focus={focused === item.id ? 'true' : undefined}
                            >
                              <div className="pm-gitem__top">
                                <span className="pm-gitem__name">{item.name}</span>
                                {item.chip}
                              </div>
                              <p>{item.body}</p>
                            </div>
                          ))}
                          {section.extra}
                        </div>
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
            <div className="pm-guide__foot">{content.footer}</div>
          </aside>
        </>,
        document.body,
      )}
    </GuideContext.Provider>
  );
}

export interface PageGuideProps {
  title: string;
  lede: string;
  sections: readonly GuideSection[];
  /** Sections open before an entry is asked for. */
  defaultOpen?: readonly string[];
  /** Extra footer content, e.g. a docs link. */
  footerExtra?: ReactNode;
  children: ReactNode;
}

/**
 * A `GuideProvider` with the common chrome (eyebrow, close label, the "press ?"
 * footer line) filled in from the shared copy, so a page hands it only its own
 * title, lede and sections.
 */
export function PageGuide({
  title,
  lede,
  sections,
  defaultOpen,
  footerExtra,
  children,
}: PageGuideProps): ReactElement {
  const copy = useMessages('ui').guideDrawer;
  const content = useMemo<GuideContent>(
    () => ({
      eyebrow: copy.eyebrow,
      title,
      lede,
      closeLabel: copy.close,
      footer: (
        <>
          <span>
            {copy.footPress} <kbd className="pm-kbd">?</kbd> {copy.footOpen} <kbd className="pm-kbd">{copy.escKey}</kbd>{' '}
            {copy.footClose}
          </span>
          {footerExtra}
        </>
      ),
      sections,
      ...(defaultOpen === undefined ? {} : { defaultOpen }),
    }),
    [copy, title, lede, sections, defaultOpen, footerExtra],
  );
  return <GuideProvider content={content}>{children}</GuideProvider>;
}
