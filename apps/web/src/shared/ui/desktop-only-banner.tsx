/**
 * DesktopOnlyBanner
 *
 * Info banner that surfaces on viewports below 1024 px and stays hidden on
 * desktop. Used by complex editors (mapping editors, raw JSON editors) that
 * remain interactive only on wider screens per `§Responsive` in the UI style
 * guide.
 */
import type { ReactElement, ReactNode } from 'react';
import { useCopy } from '../i18n/use-copy';
import { uiCopy } from './ui.copy';

interface DesktopOnlyBannerProps {
  title?: string;
  children?: ReactNode;
  className?: string;
}

export function DesktopOnlyBanner({
  title,
  children,
  className,
}: DesktopOnlyBannerProps): ReactElement {
  const copy = useCopy(uiCopy).desktopOnly;
  const classes = ['desktop-only-banner', className].filter(Boolean).join(' ');
  return (
    <div className={classes} role="note">
      <div>
        <p className="desktop-only-banner__title">{title ?? copy.title}</p>
        <p>{children ?? copy.body}</p>
      </div>
    </div>
  );
}
