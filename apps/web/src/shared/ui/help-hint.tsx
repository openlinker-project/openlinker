/**
 * HelpHint (#3935)
 *
 * The small round `?` beside a label. It opens the guide drawer at the entry the
 * label is about, so the answer is one click away without leaving the form: by
 * `guide` id through the surrounding `GuideProvider`, or through an explicit
 * `onClick` for a caller that drives the guide itself. With neither it renders
 * nothing: a hint that cannot open an answer is noise.
 *
 * @module shared/ui
 */
import type { ReactElement } from 'react';
import { useGuide } from './guide-drawer';

export interface HelpHintProps {
  /** The guide entry id to open through the surrounding `GuideProvider`. */
  guide?: string;
  /** Opens the guide some other way; wins over `guide`. */
  onClick?: () => void;
  /** Accessible name, e.g. "About: stacking with other promotions". */
  label: string;
  className?: string;
}

export function HelpHint({ guide, onClick, label, className }: HelpHintProps): ReactElement | null {
  const openGuide = useGuide();
  const open: (() => void) | null =
    onClick ??
    (guide !== undefined && openGuide !== null
      ? (): void => {
          openGuide(guide);
        }
      : null);
  if (open === null) return null;
  return (
    <button
      type="button"
      className={['pm-qmark', className].filter(Boolean).join(' ')}
      aria-label={label}
      title={label}
      onClick={open}
    >
      ?
    </button>
  );
}
