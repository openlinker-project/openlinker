/**
 * GuideDrawer
 *
 * A reference drawer ("how does this work") that slides in from the right on
 * desktop and rises as a bottom sheet on phones. Content is a list of numbered
 * accordion sections; `initialSectionId` opens the section a `?` hint pointed
 * at. It owns focus (Radix Dialog traps it and restores it on close), the Esc
 * key and the `aria-modal` contract; every string comes from the caller so the
 * component carries no copy of its own.
 *
 * Pair it with `HelpHint` / `GuideTrigger` to open it, and with the optional
 * `useGuideShortcut` hook to bind `?`.
 *
 * @module apps/web/src/shared/ui
 */
import * as RadixDialog from '@radix-ui/react-dialog';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';

export interface GuideSection {
  id: string;
  /** Two-digit ordinal shown before the title, e.g. `01`. */
  number: string;
  title: string;
  /** Short summary shown at the right of the closed header. */
  summary?: string;
  content: ReactNode;
}

export interface GuideDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eyebrow: string;
  title: string;
  lede?: string;
  closeLabel: string;
  sections: readonly GuideSection[];
  /** The section to open first; the first one when omitted. */
  initialSectionId?: string | null;
  footer?: ReactNode;
}

export function GuideDrawer({
  open,
  onOpenChange,
  eyebrow,
  title,
  lede,
  closeLabel,
  sections,
  initialSectionId,
  footer,
}: GuideDrawerProps): ReactElement {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());

  // Re-seed the open section every time the drawer opens: a `?` next to one
  // card must land on that card's section, not wherever the last visit ended.
  useEffect(() => {
    if (!open) return;
    const first = initialSectionId ?? sections[0]?.id;
    setOpenIds(new Set(first ? [first] : []));
  }, [open, initialSectionId, sections]);

  const toggle = (id: string): void => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="pm-guide-scrim" data-open="true" />
        <RadixDialog.Content
          className="pm-guide"
          data-open="true"
          aria-describedby={undefined}
          data-testid="guide-drawer"
        >
          <div className="pm-guide__handle" aria-hidden="true">
            <span />
          </div>
          <div className="pm-guide__head">
            <div className="pm-guide__top">
              <span className="eyebrow">{eyebrow}</span>
              <RadixDialog.Close asChild>
                <button type="button" className="button button--ghost button--sm pm-guide__close">
                  {closeLabel}
                </button>
              </RadixDialog.Close>
            </div>
            <RadixDialog.Title className="pm-guide__title">{title}</RadixDialog.Title>
            {lede ? <p className="pm-guide__lede">{lede}</p> : null}
          </div>
          <div className="pm-guide__body">
            {sections.map((section) => {
              const isOpen = openIds.has(section.id);
              return (
                <section
                  key={section.id}
                  className="pm-gsec"
                  data-open={isOpen ? 'true' : 'false'}
                  id={`guide-${section.id}`}
                >
                  <button
                    type="button"
                    className="pm-gsec__head"
                    aria-expanded={isOpen}
                    aria-controls={`guide-${section.id}-body`}
                    onClick={() => {
                      toggle(section.id);
                    }}
                  >
                    <span className="pm-gsec__n">{section.number}</span>
                    <span className="pm-gsec__t">{section.title}</span>
                    {section.summary ? <span className="pm-gsec__sum">{section.summary}</span> : null}
                    <span className="pm-gsec__chev" aria-hidden="true" />
                  </button>
                  <div className="pm-gsec__body" id={`guide-${section.id}-body`}>
                    <div className="pm-gsec__inner">
                      <div className="pm-gsec__list">{section.content}</div>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
          {footer ? <div className="pm-guide__foot">{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Binds `?` (outside text fields) to `onOpen`. */
export function useGuideShortcut(onOpen: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const handler = (event: KeyboardEvent): void => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (event.key === '?' && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        onOpen();
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, [onOpen, enabled]);
}
