/**
 * "Publish on this channel" affordance (#2765 review, finding 6)
 *
 * Extracted out of `product-sales-table.tsx` so the variant × channel
 * matrix can render it too. Before the extraction the affordance lived only
 * inside the desktop table's channel columns — columns the mobile card view
 * does not have — so on a phone an operator could see that a product sells
 * on one channel but not that it is missing from another, and the
 * remediation was unreachable.
 *
 * Takes the product's id and name rather than a `TopProductRow`, so nothing
 * here depends on the analytics list's own row shape.
 *
 * @module features/analytics/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';

function buildPublishHref(productId: string, connectionId: string): string {
  const params = new URLSearchParams({ productIds: productId, connectionId });
  return `/listings/bulk-create/wizard?${params.toString()}`;
}

export function ChannelPublishAction({
  productId,
  productName,
  connectionId,
  demoMode,
}: {
  productId: string;
  productName: string;
  connectionId: string;
  demoMode: boolean;
}): ReactElement | null {
  // A one-shot navigation, not a filter toggle — a real link (styled as a
  // button) rather than `Chip` (which hard-codes `aria-pressed`, exposing a
  // permanently-"not pressed" toggle to AT) or a `Button` + `navigate()`
  // (which loses middle-click / open-in-new-tab for free). The row itself is
  // an expand toggle (#2765), not a navigation anchor, so nesting an `<a>`
  // inside it is not a concern here either.
  const write = useWriteAccess('listings:write', demoMode);
  if (!write.visible) {
    return null;
  }

  const label = `Publish ${productName} on this channel — it already sells elsewhere`;

  if (write.demoReadOnly) {
    return (
      <ReadOnlyLock active message={DEMO_READ_ONLY_ACTION_MESSAGE}>
        <button
          type="button"
          className="chip chip--warning cell-not-listed__chip"
          disabled
          aria-label={label}
        >
          Publish
        </button>
      </ReadOnlyLock>
    );
  }

  return (
    <Link
      to={buildPublishHref(productId, connectionId)}
      className="chip chip--warning cell-not-listed__chip"
      aria-label={label}
    >
      Publish
    </Link>
  );
}
