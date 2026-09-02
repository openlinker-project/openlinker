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
 * There is deliberately no `Match to an order` action. Re-attribution is an
 * automatic reconcile, not a write an operator can trigger, so a button here
 * would either do nothing or imply a capability that does not exist. The copy
 * says what actually happens instead.
 *
 * @module apps/web/src/features/returns/components
 */
import type { ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { RETURNS_ORPHAN_COPY } from '../lib/returns-list.copy';
import { RETURN_ORPHAN_BANNER_COPY } from '../lib/return-detail.copy';

interface ReturnOrphanBannerProps {
  /** The channel's own order reference — the operator's only lead. */
  externalOrderId: string | null;
}

export function ReturnOrphanBanner({ externalOrderId }: ReturnOrphanBannerProps): ReactElement {
  return (
    <Alert tone="error" title={RETURN_ORPHAN_BANNER_COPY.title}>
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
