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
 * ## One of the mockup's controls is deliberately absent
 *
 * The mockup's `topbar__alerts` "Alerts 0" button has no backing data
 * anywhere in this system — there is no alerts feed for the bench, and a
 * button showing a fabricated `0` is the "camera preview" precedent
 * (`bench-documents.tsx`) run backwards: THAT control admits out loud that
 * it does nothing, this one would silently claim a real count it does not
 * have. The omission is not an oversight.
 *
 * ## The connectivity indicator ships, with its middle state REDEFINED (#3407)
 *
 * This was blocked on a design question: whether to invent scanner-hardware
 * telemetry that does not exist. The answer is no, and the indicator ships
 * anyway, because the question was the wrong one.
 *
 * The mockup's amber reads "hardware problem — scanner/printer". A
 * keyboard-wedge scanner is indistinguishable from a keyboard, so nothing
 * here can observe it, and the heuristic the issue floated — no scan in N
 * seconds while focused and online — is FALSE on a packer taping a box,
 * fetching a pallet or answering a question. An amber light on a healthy
 * bench is not a small inaccuracy: it teaches a packer to ignore the
 * indicator, which costs the red state its meaning too.
 *
 * So amber means what the bench can prove instead: **the network at this
 * bench is fine and OpenLinker is not answering.** That is a real middle
 * state with its own remedy, and it needs no new telemetry — the two causes
 * were already computed apart inside `useBenchReachability` and collapsed by
 * an `||`. The indicator is a READOUT of that hook, never a second opinion:
 * if it disagrees with the surface that refuses scans, the readout is the
 * thing that is wrong.
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

import { useBenchReachabilityContext } from '../hooks/bench-reachability-context';

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
  // Read, never derived here: the parcel pane is what reports a request that
  // got no answer, so a second `useBenchReachability()` call would give this
  // indicator a copy nobody reports into and an amber that never fires.
  const { connectivity } = useBenchReachabilityContext();
  const connectivityCopy =
    connectivity === 'link-down'
      ? benchTopbarCopy.connectivity.linkDown
      : connectivity === 'server-unreachable'
        ? benchTopbarCopy.connectivity.serverUnreachable
        : benchTopbarCopy.connectivity.ok;

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
      {/* #3422, reading #3407's decision off the ONE reachability instance the
          surface holds. A `title` carries the detail and the dot is paired
          with a word, never colour alone. */}
      <span
        className={`bench-topbar__conn bench-topbar__conn--${connectivity}`}
        data-testid="bench-connectivity"
        data-connectivity={connectivity}
        title={connectivityCopy.detail}
      >
        <span className="bench-topbar__conn-dot" aria-hidden="true" />
        <span className="bench-topbar__conn-label">{connectivityCopy.label}</span>
      </span>
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
