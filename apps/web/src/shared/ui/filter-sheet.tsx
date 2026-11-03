/**
 * Filter Sheet (#3507)
 *
 * The phone counterpart of `FilterPanel`: a bottom sheet built on the shared
 * Radix `Dialog` (focus trap, Esc, scroll lock, `aria-modal` all come from
 * Radix) with the `dialog__content--sheet` modifier. Its body holds
 * `FilterSection`s — native `<details>`/`<summary>` accordions (UI Library
 * Policy: native first, the `InlineDisclosure` precedent) whose summary line
 * shows the CURRENT value, so the operator sees every active filter without
 * opening each section.
 *
 * Controls inside write immediately, exactly like the desktop panel; the
 * footer's primary action only closes the sheet.
 *
 * @module shared/ui
 */
import type { ReactElement, ReactNode } from 'react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from './dialog';
import { FILTER_COPY } from './filter.copy';

export interface FilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  /** Visually hidden description for the dialog (Radix warns without one). */
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
  /** Extra class on the content (e.g. for a non-filter sheet reusing the shell). */
  className?: string;
}

export function FilterSheet({
  open,
  onOpenChange,
  title = FILTER_COPY.panelLabel,
  description = FILTER_COPY.panelHint,
  children,
  footer,
  closeLabel = FILTER_COPY.sheetClose,
  className = '',
}: FilterSheetProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={['dialog__content--sheet', className].filter(Boolean).join(' ')}>
        <div className="sheet__grabber" aria-hidden="true" />
        <div className="sheet__header">
          <DialogTitle>{title}</DialogTitle>
          <DialogClose asChild>
            <button type="button" className="button button--ghost button--sm" aria-label={closeLabel}>
              <span aria-hidden="true">✕</span>
            </button>
          </DialogClose>
        </div>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <div className="sheet__body">{children}</div>
        {footer ? <div className="sheet__footer">{footer}</div> : null}
      </DialogContent>
    </Dialog>
  );
}

export interface FilterSectionProps {
  title: ReactNode;
  /** Current value of the section's filters, e.g. "Allegro" or "None". */
  summary: ReactNode;
  /** Accent the summary — the section narrows the result set right now. */
  active?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function FilterSection({
  title,
  summary,
  active = false,
  defaultOpen = false,
  children,
}: FilterSectionProps): ReactElement {
  return (
    <details className="filter-section" open={defaultOpen}>
      <summary>
        <span className="filter-section__title">{title}</span>
        <span
          className={['filter-section__summary', active ? 'filter-section__summary--on' : '']
            .filter(Boolean)
            .join(' ')}
        >
          {summary}
        </span>
        <span className="filter-section__chev" aria-hidden="true">
          ›
        </span>
      </summary>
      <div className="filter-section__body">{children}</div>
    </details>
  );
}
