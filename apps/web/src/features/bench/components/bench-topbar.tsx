/**
 * The bench's own topbar (#3423, mockup-parity epic #3401)
 *
 * The mockup's `topbar` — brand mark, breadcrumb, and a user chip — built as
 * a bench-owned component rather than by reusing `AppShell`. `/bench` sits
 * deliberately outside `AuthenticatedAppLayout` (#2413's own settled
 * decision, restated in `bench-page.tsx`'s docblock): the idle lock clears
 * the session on purpose, and `AppShell` answers an anonymous session by
 * navigating to `/login`, which would unmount the bench mid-parcel. Reusing
 * it here would reopen exactly that.
 *
 * ## Two of the mockup's controls are deliberately absent
 *
 * The mockup's `topbar__alerts` "Alerts 0" button has no backing data
 * anywhere in this system — there is no alerts feed for the bench, and a
 * button showing a fabricated `0` is the "camera preview" precedent
 * (`bench-documents.tsx`) run backwards: THAT control admits out loud that
 * it does nothing, this one would silently claim a real count it does not
 * have. And the connectivity indicator (`connStatus`/`connDot`) is #3422's,
 * itself blocked on #3407's unresolved design question — whether OpenLinker
 * should invent scanner-hardware-health telemetry that does not exist today.
 * Neither omission is an oversight.
 *
 * The theme toggle IS rendered — `ThemeToggle` is a real, already-shipped
 * feature (`shared/ui/theme-toggle.tsx`), not a mockup-only idea, and
 * `ThemeProvider` wraps the whole app regardless of route.
 *
 * @module apps/web/src/features/bench/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { formatInitials } from '../../../shared/format/format-initials';
import { ThemeToggle } from '../../../shared/ui/theme-toggle';
import { benchTopbarCopy } from '../lib/bench-topbar.copy';

export interface BenchTopbarProps {
  /** `null` while no session is signed in — the chip renders nothing then. */
  readonly signedInName: string | null;
  /**
   * Whether this viewer has an application to go back to.
   *
   * `/bench` is a top-level route with no `AppShell` and no sidebar (#2413,
   * for reasons `bench.route.tsx` sets out), so until now it was a screen you
   * could only leave by editing the address bar. That is right for a packer at
   * a terminal and wrong for the admin or operator who opened it to look.
   *
   * Resolved by the caller from `orders:write`, held by exactly admin and
   * operator — `ROLE_PERMISSIONS.packer` is `[]`, so a packer never sees the
   * crumb become a link, and an anonymous (locked) session never does either.
   */
  readonly canLeaveBench: boolean;
}

export function BenchTopbar({ signedInName, canLeaveBench }: BenchTopbarProps): ReactElement {
  return (
    <header className="bench-topbar" data-testid="bench-topbar">
      <div className="bench-topbar__brand">
        <span className="bench-topbar__brand-mark" aria-hidden="true">
          OL
        </span>
        <span className="bench-topbar__brand-name">OpenLinker</span>
      </div>
      {/* The crumb IS the way out. A breadcrumb whose parent does nothing is a
          control shaped like a link that is not one; where the viewer can use
          the parent, it behaves like the parent. `/fulfillment` rather than the
          dashboard because that is the bench's actual parent — the work list
          these parcels come from. */}
      <nav className="bench-topbar__crumbs" aria-label="Breadcrumb">
        {canLeaveBench ? (
          <Link className="bench-topbar__crumbs-up" to="/fulfillment">
            {benchTopbarCopy.parentCrumb}
          </Link>
        ) : (
          <span>{benchTopbarCopy.parentCrumb}</span>
        )}
        <span aria-hidden="true">/</span>
        <span className="bench-topbar__crumbs-current">{benchTopbarCopy.currentCrumb}</span>
      </nav>
      {canLeaveBench ? (
        <Link className="bench-topbar__leave" to="/fulfillment">
          {benchTopbarCopy.leaveAction}
        </Link>
      ) : null}
      <div className="bench-topbar__spacer" />
      <ThemeToggle className="bench-topbar__theme-toggle" />
      {signedInName === null ? null : (
        <span className="bench-topbar__user-chip">
          <span className="bench-topbar__user-avatar" aria-hidden="true">
            {formatInitials(signedInName)}
          </span>
          <span className="bench-topbar__user-name">{signedInName}</span>
        </span>
      )}
    </header>
  );
}
