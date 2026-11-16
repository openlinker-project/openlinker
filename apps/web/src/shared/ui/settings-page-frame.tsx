/**
 * SettingsPageFrame (#4136)
 *
 * What a settings screen renders: the optional back link and header extras
 * (help link, guide button) on one bar, then the shared `SettingsPageTemplate`.
 * The template itself has no slot for navigation, and every settings screen
 * needs the same one, so it lives here once instead of in each page.
 *
 * @module shared/ui
 */
import type { ReactElement, ReactNode } from 'react';
import { BackLink } from './back-link';
import { SettingsPageTemplate, type SettingsPageTemplateProps } from './settings-page-template';

export interface SettingsPageFrameProps extends SettingsPageTemplateProps {
  backTo?: { to: string; label: ReactNode; 'data-testid'?: string };
  /** Right side of the bar above the title (help link, guide button). */
  headerExtra?: ReactNode;
}

export function SettingsPageFrame({
  backTo,
  headerExtra,
  ...template
}: SettingsPageFrameProps): ReactElement {
  return (
    <section className="page-section settings-frame">
      {backTo || headerExtra ? (
        <div className="settings-frame__bar">
          {backTo ? (
            <BackLink to={backTo.to} label={backTo.label} data-testid={backTo['data-testid']} />
          ) : (
            <span />
          )}
          {headerExtra ? <div className="settings-frame__extra">{headerExtra}</div> : null}
        </div>
      ) : null}
      <SettingsPageTemplate {...template} />
    </section>
  );
}
