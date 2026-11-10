/**
 * HelpHint (#3935)
 *
 * The small round `?` beside a label. It opens the guide drawer at the entry the
 * label is about, so the answer is one click away without leaving the form. It
 * does nothing outside a `GuideProvider`, and then renders nothing: a hint that
 * cannot open an answer is noise.
 *
 * @module shared/ui
 */
import type { ReactElement } from 'react';
import { useGuide } from './guide-drawer';

export interface HelpHintProps {
  /** The guide entry id to open. */
  guide: string;
  /** Accessible name, e.g. "About: stacking with other promotions". */
  label: string;
  className?: string;
}

export function HelpHint({ guide, label, className }: HelpHintProps): ReactElement | null {
  const openGuide = useGuide();
  if (openGuide === null) return null;
  return (
    <button
      type="button"
      className={['pm-qmark', className].filter(Boolean).join(' ')}
      aria-label={label}
      title={label}
      onClick={() => {
        openGuide(guide);
      }}
    >
      ?
    </button>
  );
}
