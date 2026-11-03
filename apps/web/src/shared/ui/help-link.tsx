/**
 * Help Link (#81)
 *
 * A small contextual link to the relevant `docs.openlinker.io` page, meant to
 * sit beside a setting or a panel title. Always opens in a new tab (an
 * operator following it should not lose the form they were filling in) and
 * always carries `rel="noopener noreferrer"` (a new-tab link to a page this
 * app does not control must not hand it a `window.opener` reference).
 *
 * Resolves its URL from `HELP_LINKS` — never a literal string per call site —
 * so a moved docs page is fixed in one place.
 *
 * @module apps/web/src/shared/ui
 */
import type { ReactElement } from 'react';
import { HELP_LINKS, HELP_LINK_LABELS, type HelpSurfaceKey } from '../lib/help-links';

export interface HelpLinkProps {
  readonly surfaceKey: HelpSurfaceKey;
  readonly className?: string;
}

export function HelpLink({ surfaceKey, className }: HelpLinkProps): ReactElement {
  const href = HELP_LINKS[surfaceKey];
  const label = HELP_LINK_LABELS[surfaceKey];

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={['help-link', className].filter(Boolean).join(' ')}
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true" className="help-link__glyph">
        ?
      </span>
    </a>
  );
}
