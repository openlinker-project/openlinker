/**
 * Return Orphan Banner
 *
 * The top-of-page statement that nothing can be done with this return yet
 * (returns spec §5.5).
 *
 * It **imports** `RETURNS_ORPHAN_COPY.explanation` rather than restating it.
 * That sentence is the canonical description of the orphan state and the list
 * already renders it; two wordings for one state is exactly the drift the copy
 * modules exist to prevent.
 *
 * **Corrected by #3078/#3085.** This docblock used to say there is
 * deliberately no `Match to an order` action, because before that epic the
 * write (`POST /returns/:returnId/match-order`, #2372/#2376) had no caller in
 * `apps/web` at all — a button here really would have done nothing. That
 * epic built the write's dialog (`MatchReturnDialog`, #3082) and this banner
 * is now its detail-page mount point: an optional `action` slot, rendered
 * only when the caller supplies one, so a page that has not wired the dialog
 * degrades to the pre-#3078 explanation-only banner rather than throwing.
 *
 * @module apps/web/src/features/returns/components
 */
import type { ReactElement, ReactNode } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { RETURNS_ORPHAN_COPY } from '../lib/returns-list.copy';
import { RETURN_ORPHAN_BANNER_COPY } from '../lib/return-detail.copy';

interface ReturnOrphanBannerProps {
  /** The channel's own order reference — the operator's only lead. */
  externalOrderId: string | null;
  /** The "Match to an order" trigger, or nothing when the caller has none. */
  action?: ReactNode;
}

export function ReturnOrphanBanner({
  externalOrderId,
  action,
}: ReturnOrphanBannerProps): ReactElement {
  return (
    <Alert tone="error" title={RETURN_ORPHAN_BANNER_COPY.title} action={action}>
      <p>{RETURNS_ORPHAN_COPY.explanation}</p>
      <p>
        {RETURN_ORPHAN_BANNER_COPY.safeHere} {RETURN_ORPHAN_BANNER_COPY.reattribution}
      </p>
      {externalOrderId !== null ? (
        <p>
          {/* The reference the reconcile will match on. Shown because it is the
              one value an operator can search for at the channel. */}
          <span className="mono-text">{externalOrderId}</span>
        </p>
      ) : null}
    </Alert>
  );
}
