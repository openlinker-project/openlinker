/**
 * GuideDrawer
 *
 * The page guide: a side sheet (a bottom sheet on a phone, with drag-to-close)
 * that explains one screen in numbered sections, each a short list of named
 * items. A `HelpHint` beside a label opens it on the matching item, which is
 * scrolled to and flashed; the `?` key opens it at the top.
 *
 * Generic on purpose: the caller owns the copy and the section list, this owns
 * the chrome, focus handling (Radix Dialog: focus trap, Esc, inert page) and
 * motion (all of it off under `prefers-reduced-motion`). Pair with
 * `useGuideDrawer` for the open/focused-item state and the `?` shortcut.
 *
 * @module shared/ui
 */
import * as RadixDialog from '@radix-ui/react-dialog';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useMessages } from '../i18n/use-messages';

export interface GuideItem {
  /** Target of a `HelpHint`: the guide opens on this item. */
  id: string;
  name: string;
  text: ReactNode;
}

export interface GuideSection {
  id: string;
  /** Shown in mono beside the title, e.g. `01`. */
  number: string;
  title: string;
  /** One short line on the closed section header. */
  summary?: string;
  defaultOpen?: boolean;
  items: readonly GuideItem[];
}

export interface GuideDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  lede: string;
  sections: readonly GuideSection[];
  /** The item a hint pointed at; its section opens and it flashes. */
  focusItemId?: string | null;
  /** Extra footer content, e.g. a docs link. */
  footer?: ReactNode;
}

const REDUCED = '(prefers-reduced-motion: reduce)';
const PHONE = '(max-width: 640px)';

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.(REDUCED).matches ?? false);
}

export function GuideDrawer({
  open,
  onOpenChange,
  title,
  lede,
  sections,
  focusItemId = null,
  footer,
}: GuideDrawerProps): ReactElement {
  const copy = useMessages('ui').guideDrawer;
  const contentRef = useRef<HTMLDivElement>(null);
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(
    () => new Set(sections.filter((section) => section.defaultOpen).map((section) => section.id)),
  );
  const [flashId, setFlashId] = useState<string | null>(null);

  // Opening on an item shows its section and nothing else: that is what the
  // hint promised, and a second open section would push the item off screen.
  useEffect(() => {
    if (!open || focusItemId === null) return undefined;
    const section = sections.find((candidate) => candidate.items.some((item) => item.id === focusItemId));
    if (section === undefined) return undefined;
    setOpenSections(new Set([section.id]));
    const timer = window.setTimeout(
      () => {
        const node = contentRef.current?.querySelector<HTMLElement>(`[data-guide-item="${focusItemId}"]`);
        node?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
        setFlashId(null);
        window.requestAnimationFrame(() => setFlashId(focusItemId));
      },
      reducedMotion() ? 0 : 320,
    );
    return () => window.clearTimeout(timer);
  }, [open, focusItemId, sections]);

  const toggle = (id: string): void => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const drag = useRef<{ y: number; t: number } | null>(null);
  const onDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!window.matchMedia?.(PHONE).matches) return;
    if ((event.target as HTMLElement).closest('button,a,input')) return;
    drag.current = { y: event.clientY, t: performance.now() };
    contentRef.current?.setAttribute('data-dragging', 'true');
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onMove = (event: ReactPointerEvent<HTMLElement>): void => {
    if (drag.current === null) return;
    const dy = event.clientY - drag.current.y;
    contentRef.current?.style.setProperty('--drag', `${dy > 0 ? dy : dy * 0.06}px`);
  };
  const onUp = (event: ReactPointerEvent<HTMLElement>): void => {
    const start = drag.current;
    if (start === null) return;
    drag.current = null;
    const dy = event.clientY - start.y;
    const velocity = (dy / Math.max(1, performance.now() - start.t)) * 1000;
    const node = contentRef.current;
    node?.setAttribute('data-dragging', 'false');
    node?.style.setProperty('--drag', '0px');
    if (dy > (node?.offsetHeight ?? 0) * 0.3 || velocity > 450) onOpenChange(false);
  };
  const dragHandlers = {
    onPointerDown: onDown,
    onPointerMove: onMove,
    onPointerUp: onUp,
    onPointerCancel: onUp,
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="guide-drawer__scrim" />
        <RadixDialog.Content
          ref={contentRef}
          className="guide-drawer"
          aria-describedby="guide-drawer-lede"
          data-testid="guide-drawer"
        >
          <div className="guide-drawer__handle" aria-hidden="true" {...dragHandlers}>
            <span />
          </div>
          <div className="guide-drawer__head" {...dragHandlers}>
            <div className="guide-drawer__top">
              <span className="eyebrow">{copy.eyebrow}</span>
              <RadixDialog.Close className="button button--ghost button--sm" aria-label={copy.closeLabel}>
                {copy.close}
              </RadixDialog.Close>
            </div>
            <RadixDialog.Title className="guide-drawer__title">{title}</RadixDialog.Title>
            <p className="guide-drawer__lede" id="guide-drawer-lede">
              {lede}
            </p>
          </div>
          <div className="guide-drawer__body">
            {sections.map((section) => {
              const expanded = openSections.has(section.id);
              return (
                <section key={section.id} className="guide-drawer__section" data-open={expanded}>
                  <button
                    type="button"
                    className="guide-drawer__section-head"
                    aria-expanded={expanded}
                    aria-controls={`${section.id}-body`}
                    onClick={() => toggle(section.id)}
                  >
                    <span className="guide-drawer__section-n">{section.number}</span>
                    <span className="guide-drawer__section-t">{section.title}</span>
                    {section.summary === undefined ? null : (
                      <span className="guide-drawer__section-sum">{section.summary}</span>
                    )}
                    <span className="guide-drawer__chev" aria-hidden="true" />
                  </button>
                  <div className="guide-drawer__section-body" id={`${section.id}-body`}>
                    <div className="guide-drawer__section-inner">
                      <div className="guide-drawer__items">
                        {section.items.map((item) => (
                          <div
                            key={item.id}
                            className="guide-drawer__item"
                            data-guide-item={item.id}
                            data-focus={flashId === item.id ? 'true' : undefined}
                          >
                            <span className="guide-drawer__item-name">{item.name}</span>
                            <p>{item.text}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
          <div className="guide-drawer__foot">
            <span>
              {copy.footPress} <kbd className="guide-drawer__kbd">?</kbd> {copy.footOpen}{' '}
              <kbd className="guide-drawer__kbd">Esc</kbd> {copy.footClose}
            </span>
            {footer}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export interface UseGuideDrawerResult {
  open: boolean;
  itemId: string | null;
  /** Opens the guide, on one item when given. */
  show: (itemId?: string) => void;
  onOpenChange: (open: boolean) => void;
}

/**
 * Open state for a `GuideDrawer`, plus the `?` shortcut. The shortcut stays out
 * of the way of typing: it never fires inside a field or with a modifier held.
 */
export function useGuideDrawer(): UseGuideDrawerResult {
  const [state, setState] = useState<{ open: boolean; itemId: string | null }>({
    open: false,
    itemId: null,
  });
  const show = useCallback((itemId?: string) => setState({ open: true, itemId: itemId ?? null }), []);
  const onOpenChange = useCallback((open: boolean) => setState((s) => ({ ...s, open })), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input,textarea,select,[contenteditable="true"]')) return;
      event.preventDefault();
      show();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [show]);

  return { open: state.open, itemId: state.itemId, show, onOpenChange };
}

export interface GuideButtonProps {
  label: string;
  onClick: () => void;
}

/** The page-header button that opens the guide. */
export function GuideButton({ label, onClick }: GuideButtonProps): ReactElement {
  return (
    <button type="button" className="button button--secondary button--sm guide-button" onClick={onClick}>
      <span className="help-hint help-hint--static" aria-hidden="true">
        ?
      </span>
      {label}
      <span className="button__shortcut" aria-hidden="true">
        ?
      </span>
    </button>
  );
}
