/**
 * Bench identity bar (#2413, story A4)
 *
 * > *Given the surface is open, then the signed-in packer's name is visible
 * > without opening a menu, in the same glance as the item being scanned.*
 *
 * So: rendered inline at the top of the bench, never inside a dropdown, never
 * behind an avatar you have to click. The app shell's `UserChip` already shows
 * a name, but only in the drawer/menu chrome — which is exactly the "open a
 * menu" this story rules out.
 *
 * ADR-071's stated failure mode is MIS-ATTRIBUTION, and the two rails against
 * it are the idle lock and this bar. It is not decoration.
 *
 * @module apps/web/src/features/bench/components
 */
import type { ReactElement } from 'react';

import { Button } from '../../../shared/ui/button';
import { benchIdentityCopy } from '../lib/bench-identity.copy';

export interface BenchIdentityBarProps {
  readonly signedInName: string | null;
  readonly onSwitchPacker: () => void;
}

export function BenchIdentityBar({
  signedInName,
  onSwitchPacker,
}: BenchIdentityBarProps): ReactElement {
  return (
    <div className="bench-identity-bar" data-testid="bench-identity-bar">
      {/* The whole span branches, not just the name: rendering the "Signed in"
          LABEL beside "Nobody is signed in" is the one contradiction a packer
          approaching a locked shared terminal would read first. */}
      <span className="bench-identity-bar__who">
        {signedInName === null ? (
          <span className="bench-identity-bar__label">{benchIdentityCopy.bar.signedOutLabel}</span>
        ) : (
          <>
            <span className="bench-identity-bar__label">
              {benchIdentityCopy.bar.signedInLabel}
            </span>{' '}
            <strong className="bench-identity-bar__name">{signedInName}</strong>
          </>
        )}
      </span>
      <Button
        type="button"
        className="button--sm"
        onClick={onSwitchPacker}
        disabled={signedInName === null}
        title={benchIdentityCopy.bar.switchHint}
      >
        {benchIdentityCopy.bar.switchAction}
      </Button>
    </div>
  );
}
