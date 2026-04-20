/**
 * DesktopOnlyBanner
 *
 * Info banner that surfaces on viewports below 1024 px and stays hidden on
 * desktop. Used by complex editors (mapping editors, raw JSON editors) that
 * remain interactive only on wider screens per `§Responsive` in the UI style
 * guide.
 */
import type { ReactElement, ReactNode } from 'react';

interface DesktopOnlyBannerProps {
  title?: string;
  children?: ReactNode;
}

export function DesktopOnlyBanner({
  title = 'Open on a desktop screen to edit',
  children = 'This editor needs a wider screen to show both sides side by side. The view below is read-only on this viewport.',
}: DesktopOnlyBannerProps): ReactElement {
  return (
    <div className="desktop-only-banner" role="note">
      <div>
        <p className="desktop-only-banner__title">{title}</p>
        <p>{children}</p>
      </div>
    </div>
  );
}
