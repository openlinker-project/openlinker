/**
 * HelpHint / GuideTrigger
 *
 * `HelpHint` is the small round `?` that sits beside a label and opens the
 * guide at the section that explains it. `GuideTrigger` is the header button
 * ("How bundles work ?") that opens the guide at its first section. Neither
 * knows what the guide says: the caller owns the open state.
 *
 * @module apps/web/src/shared/ui
 */
import type { ReactElement } from 'react';

export interface HelpHintProps {
  /** Accessible name, e.g. "Help: availability". */
  label: string;
  onClick: () => void;
}

export function HelpHint({ label, onClick }: HelpHintProps): ReactElement {
  return (
    <button type="button" className="pm-qmark" aria-label={label} onClick={onClick}>
      ?
    </button>
  );
}

export interface GuideTriggerProps {
  label: string;
  onClick: () => void;
  /** Shows the `?` key cap; only when the page binds the shortcut. */
  showShortcut?: boolean;
}

export function GuideTrigger({ label, onClick, showShortcut = true }: GuideTriggerProps): ReactElement {
  return (
    <button
      type="button"
      className="button button--secondary button--sm pm-helpbtn"
      onClick={onClick}
      data-testid="guide-trigger"
    >
      <span className="pm-qmark" aria-hidden="true">
        ?
      </span>
      {label}
      {showShortcut ? (
        <span className="button__shortcut" aria-hidden="true">
          ?
        </span>
      ) : null}
    </button>
  );
}
