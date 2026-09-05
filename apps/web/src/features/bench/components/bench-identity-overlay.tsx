/**
 * Bench identity overlay (#2413, stories A2 / A3, ADR-071)
 *
 * The locked / sign-in / handover states of the `bench-identity` mockup,
 * rendered **above** the bench body rather than in place of it.
 *
 * ## The overlay-not-route-change decision is the whole mechanism
 *
 * *"Locking never discards progress"* (A3) and *"verification progress on an
 * open parcel survives the switch"* (A2) are both delivered by the same fact:
 * `children` are never unmounted. A route change to `/login`, or an early
 * `return` that renders the overlay INSTEAD of the children, would tear down
 * the bench body and take the packer's half-verified parcel with it. So the
 * children are always rendered, and the overlay sits on top.
 *
 * ## Which is exactly why the locked state must also HIDE them
 *
 * Keeping the body mounted means keeping it in the DOM, and the locked screen
 * must show *"nothing about the order — no reference, no buyer, no address,
 * nothing about what is in the box"*, because a shared floor terminal is
 * routinely unattended. Mounted-but-hidden is therefore load-bearing and is
 * done twice over: the body is `aria-hidden` and `inert` for assistive tech and
 * focus, and it carries `bench-body--concealed`, whose stylesheet rule blanks
 * it visually. A test asserts the locked state exposes no body content.
 *
 * The session is separately CLEARED on lock — see `use-bench-identity.ts`. An
 * overlay over a live token is a curtain, not a lock.
 *
 * @module apps/web/src/features/bench/components
 */
import type { ReactElement, ReactNode } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { LoginForm } from '../../auth';
import type { BenchIdentityState } from '../hooks/use-bench-identity';
import { benchIdentityCopy } from '../lib/bench-identity.copy';

export interface BenchIdentityOverlayProps {
  readonly state: BenchIdentityState;
  readonly onConfirmHandover: () => void;
  readonly onCancelHandover: () => void;
  /** The bench body. Never unmounted — see the module docblock. */
  readonly children: ReactNode;
}

export function BenchIdentityOverlay({
  state,
  onConfirmHandover,
  onCancelHandover,
  children,
}: BenchIdentityOverlayProps): ReactElement {
  // **Only `locked` conceals, and the asymmetry is the design, not an
  // oversight.** A locked bench may be unattended, so it shows nothing about
  // the order. A HANDOVER is two people standing at the bench: spec D13 makes
  // whoever finishes the box the one recorded as having packed it, so the
  // incoming packer must see what the outgoing one already verified BEFORE
  // taking it on — concealing the body there would hide the only thing the
  // handover screen exists to show, and the outgoing packer is still signed in
  // and present either way.
  const concealed = state === 'locked';

  return (
    <div className="bench-surface">
      <div
        className={concealed ? 'bench-body bench-body--concealed' : 'bench-body'}
        data-testid="bench-body"
        aria-hidden={concealed || undefined}
        // `inert` keeps focus and assistive tech out of a concealed body. React
        // 18 does not type it, hence the cast; the attribute is what browsers
        // read, and any value counts as present — `'true'` rather than `''`
        // because React drops an empty-string unknown attribute, which would
        // leave the concealment resting on CSS alone.
        {...(concealed ? ({ inert: 'true' } as Record<string, string>) : {})}
      >
        {children}
      </div>

      {state === 'locked' && (
        <div className="bench-overlay" role="dialog" aria-modal="true" data-testid="bench-locked">
          <h2>{benchIdentityCopy.locked.title}</h2>
          <p>{benchIdentityCopy.locked.body}</p>
          <Alert tone="info">{benchIdentityCopy.locked.progressReassurance}</Alert>
          <h3>{benchIdentityCopy.signIn.title}</h3>
          <p>{benchIdentityCopy.signIn.body}</p>
          {/* The ordinary account form. ADR-071 rejects a PIN pad and a badge
              reader, so there is deliberately nothing else here. */}
          <LoginForm />
        </div>
      )}

      {state === 'handover' && (
        <div className="bench-overlay" role="dialog" aria-modal="true" data-testid="bench-handover">
          <h2>{benchIdentityCopy.handover.title}</h2>
          {/* Spec D13: whoever finishes the box is recorded as having packed
              it, so the incoming packer is told BEFORE the switch. What was
              already verified is rendered by the bench body's own summary
              (#2418); this step is the warning that makes it worth reading. */}
          <p>{benchIdentityCopy.handover.body}</p>
          <Button type="button" tone="primary" onClick={onConfirmHandover}>
            {benchIdentityCopy.handover.confirmAction}
          </Button>
          <Button type="button" onClick={onCancelHandover}>
            {benchIdentityCopy.handover.cancelAction}
          </Button>
        </div>
      )}
    </div>
  );
}
