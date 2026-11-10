/**
 * GuideDrawer (#3935)
 *
 * The "How does this work?" drawer a page opens from its header button or with
 * `?`. A SidePanel carrying a title, an intro and numbered accordion sections.
 * Generic on purpose: the page supplies the words, the drawer supplies the
 * numbering, the accordion and the `?` shortcut hint. Pass `initialSectionId`
 * to open a given section (a `HelpHint` deep link).
 *
 * `useGuideShortcut` binds `?` outside text fields so every guide opens the
 * same way. The key is ignored while another dialog or field has focus.
 *
 * @module shared/ui
 */
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { SidePanel } from './side-panel';

export interface GuideSection {
  id: string;
  title: string;
  /** Small mono tag beside the title ("two icons", "2 decisions"). */
  tag?: string;
  body: ReactNode;
}

export interface GuideDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Small line above the title; defaults to nothing. */
  kicker?: string;
  title: string;
  intro: string;
  sections: readonly GuideSection[];
  /** Section opened first; the others start closed. Defaults to the first. */
  initialSectionId?: string | null;
  /** Footer hint, e.g. "Press ? on this page to open the guide, Esc closes." */
  footerHint?: ReactNode;
  closeLabel?: string;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Opens a guide on `?`, except while the operator is typing. */
export function useGuideShortcut(onOpen: () => void): void {
  useEffect(() => {
    function onKeydown(event: KeyboardEvent): void {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (event.key === '?') {
        event.preventDefault();
        onOpen();
      }
    }
    document.addEventListener('keydown', onKeydown);
    return () => {
      document.removeEventListener('keydown', onKeydown);
    };
  }, [onOpen]);
}

export function GuideDrawer({
  open,
  onOpenChange,
  kicker,
  title,
  intro,
  sections,
  initialSectionId,
  footerHint,
  closeLabel,
}: GuideDrawerProps): ReactElement {
  const firstId = initialSectionId === undefined ? (sections[0]?.id ?? null) : initialSectionId;
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set(firstId ? [firstId] : []));

  useEffect(() => {
    if (open) setOpenIds(new Set(firstId ? [firstId] : []));
  }, [open, firstId]);

  const toggle = (id: string): void => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      kicker={kicker}
      title={title}
      description={intro}
      width={440}
      closeLabel={closeLabel}
      className="guide-drawer"
      footer={footerHint ? <p className="guide-drawer__hint">{footerHint}</p> : undefined}
    >
      <p className="guide-drawer__intro">{intro}</p>
      <ol className="guide-drawer__sections">
        {sections.map((section, index) => {
          const expanded = openIds.has(section.id);
          return (
            <li
              key={section.id}
              id={`guide-${section.id}`}
              className="guide-drawer__section"
              data-open={expanded}
            >
              <button
                type="button"
                className="guide-drawer__head"
                aria-expanded={expanded}
                onClick={() => {
                  toggle(section.id);
                }}
              >
                <span className="guide-drawer__num mono-text" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="guide-drawer__title">{section.title}</span>
                {section.tag ? <span className="guide-drawer__tag mono-text">{section.tag}</span> : null}
                <span className="guide-drawer__chev" aria-hidden="true">
                  {expanded ? '▲' : '▼'}
                </span>
              </button>
              {expanded ? <div className="guide-drawer__body">{section.body}</div> : null}
            </li>
          );
        })}
      </ol>
    </SidePanel>
  );
}
