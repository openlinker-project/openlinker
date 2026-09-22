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

import { ThemeToggle } from '../../../shared/ui/theme-toggle';

export interface BenchTopbarProps {
  /** `null` while no session is signed in — the chip renders nothing then. */
  readonly signedInName: string | null;
}

/** First-and-last initial, uppercased — the mockup's own `shell-user-chip__avatar` shape. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = words[0]?.charAt(0) ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase();
}

export function BenchTopbar({ signedInName }: BenchTopbarProps): ReactElement {
  return (
    <header className="bench-topbar" data-testid="bench-topbar">
      <div className="bench-topbar__brand">
        <span className="bench-topbar__brand-mark" aria-hidden="true">
          OL
        </span>
        <span className="bench-topbar__brand-name">OpenLinker</span>
      </div>
      <nav className="bench-topbar__crumbs" aria-label="Breadcrumb">
        <span>Operations</span>
        <span aria-hidden="true">/</span>
        <span className="bench-topbar__crumbs-current">Pack bench</span>
      </nav>
      <div className="bench-topbar__spacer" />
      <ThemeToggle className="bench-topbar__theme-toggle" />
      {signedInName === null ? null : (
        <span className="bench-topbar__user-chip">
          <span className="bench-topbar__user-avatar" aria-hidden="true">
            {initialsOf(signedInName)}
          </span>
          <span className="bench-topbar__user-name">{signedInName}</span>
        </span>
      )}
    </header>
  );
}
