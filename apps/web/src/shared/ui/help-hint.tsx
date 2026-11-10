/**
 * HelpHint
 *
 * The small `?` beside a label. It opens the page guide on the item that
 * explains this label (`useGuideDrawer().show(itemId)`); it carries no copy of
 * its own, so the explanation lives once, in the guide.
 *
 * @module shared/ui
 */
import type { ReactElement } from 'react';

export interface HelpHintProps {
  /** Full accessible name, e.g. "About: gift on the document". */
  label: string;
  onClick: () => void;
  className?: string;
}

export function HelpHint({ label, onClick, className }: HelpHintProps): ReactElement {
  return (
    <button
      type="button"
      className={['help-hint', className].filter(Boolean).join(' ')}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      ?
    </button>
  );
}
