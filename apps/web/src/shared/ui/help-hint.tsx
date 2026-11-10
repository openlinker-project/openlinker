/**
 * HelpHint (#3935)
 *
 * A small `?` button that opens a guide at one section: the answer to "what
 * does this mean?" at the exact spot the question comes up, without leaving
 * the page. The page owns the guide state; the hint only calls `onOpen`.
 *
 * @module shared/ui
 */
import type { ReactElement } from 'react';

export interface HelpHintProps {
  /** Accessible name, e.g. "How gifts show on the document". */
  label: string;
  onOpen: (sectionId?: string) => void;
  /** Section to open in the guide. */
  sectionId?: string;
  className?: string;
}

export function HelpHint({ label, onOpen, sectionId, className }: HelpHintProps): ReactElement {
  return (
    <button
      type="button"
      className={['help-hint', className].filter(Boolean).join(' ')}
      aria-label={label}
      title={label}
      onClick={() => {
        onOpen(sectionId);
      }}
    >
      <span aria-hidden="true">?</span>
    </button>
  );
}
