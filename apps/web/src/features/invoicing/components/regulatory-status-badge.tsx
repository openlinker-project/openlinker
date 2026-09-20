/**
 * Regulatory Status Badge (#757, neutralized #3181)
 *
 * Maps a `RegulatoryStatus` to a `StatusBadge` tone + `t()` label. Rendered
 * ONLY by the panel's `regulatoryStatus !== 'not-applicable'` gate (plan §1.6),
 * so `not-applicable` never reaches here.
 *
 * Regulator-neutral by construction (ADR-026 country-agnostic design, #3181
 * decision 7): `RegulatoryStatus` is shared vocabulary across every
 * `InvoicingPort` adapter (KSeF transmits directly, inFakt and Subiekt relay
 * to KSeF on the seller's behalf) and this component lives in a **shared**
 * feature folder, so its default labels must not name one regulator. A
 * provider whose own invoice-detail surface wants its own branded wording
 * (e.g. the KSeF plugin) supplies it via the optional `labelOverrides` prop
 * rather than baking it in here — see `KsefInvoiceDetailSection`. That
 * override outranks the translated `invoice.regulatory.*` catalog entry, which
 * is neutral by design and would otherwise contradict it.
 *
 * @module apps/web/src/features/invoicing/components
 */
import type { ReactElement } from 'react';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { useTranslation } from '../../../shared/i18n';
import type { RegulatoryStatus } from '../api/invoicing.types';

const TONE: Record<RegulatoryStatus, StatusBadgeTone> = {
  'not-applicable': 'neutral',
  // Offline degraded-mode window (#1585): ISSUED but NOT yet transmitted. Amber
  // `warning` — a sweep is resubmitting (no operator action owed), but it is NOT
  // a submission/clearance success and must never read as one.
  'pending-submission': 'warning',
  submitted: 'info',
  // `cleared` is a reserved split-clearance status no current provider emits;
  // terminal regulatory success is `accepted`. Never render `cleared` as
  // `success` — keep it a non-terminal `info` so an unconfirmed clearance can
  // never read as done (matches the constraint documented in invoicing.types.ts).
  cleared: 'info',
  accepted: 'success',
  rejected: 'error',
};

/**
 * Regulator-neutral English fallback labels for each `RegulatoryStatus`.
 * Exported so the invoices list-page filter reuses the SAME labels the badge
 * renders (#1585 F7) instead of falling back to the raw hyphenated enum slug
 * (`pending-submission`). Carries no regulator name (#3181) — a
 * provider-specific surface overrides via `labelOverrides` instead.
 */
export const REGULATORY_STATUS_LABEL_FALLBACK: Record<RegulatoryStatus, string> = {
  'not-applicable': 'N/A',
  'pending-submission': 'Awaiting submission',
  submitted: 'Submitted',
  cleared: 'Clearing',
  accepted: 'Accepted',
  rejected: 'Rejected',
};

const LABEL_FALLBACK = REGULATORY_STATUS_LABEL_FALLBACK;

/**
 * Test hook for the ONE state a document is waiting with its provider in
 * (#3192): issued, legally effective, and not yet sent on for clearance.
 *
 * Emitted only for `pending-submission`, so its presence IS the assertion -
 * a hook on every badge would say nothing about which state the badge is in.
 * It rides the shared badge rather than a per-surface element because that
 * badge is what renders the words "Awaiting submission" on all three surfaces
 * that show a clearance state (the order-detail sales-document panel's
 * Clearance row, the invoice detail page, the invoices list row), so one
 * definition covers all three and they cannot drift apart.
 *
 * Note the list renders one badge PER ROW, so a spec on `/invoices` reads it
 * with `getAllByTestId`; the mockup's own row hooks (`invoice-row-waiting-*`)
 * are what a single row is addressed by there.
 */
const REGULATORY_WAITING_TEST_ID = 'sales-document-status-waiting';

interface RegulatoryStatusBadgeProps {
  status: RegulatoryStatus;
  /**
   * Provider-supplied label override (#3181). A per-provider surface (e.g.
   * the KSeF plugin's own invoice-detail section) may pass its own branded
   * label map here; the shared default stays regulator-neutral. Absent ⇒
   * `REGULATORY_STATUS_LABEL_FALLBACK`.
   */
  labelOverrides?: Partial<Record<RegulatoryStatus, string>>;
}

export function RegulatoryStatusBadge({
  status,
  labelOverrides,
}: RegulatoryStatusBadgeProps): ReactElement {
  const { t } = useTranslation();
  // The override is resolved OUTSIDE `t()`, never handed to it as the fallback
  // argument: `t(key, fallback)` returns the CATALOG hit and falls back only on
  // a miss, and `invoice.regulatory.*` is by design the regulator-NEUTRAL key —
  // so a provider override passed as the fallback would become unreachable the
  // day anyone populates that key, silently and with no test failing.
  const label =
    labelOverrides?.[status] ?? t(`invoice.regulatory.${status}`, LABEL_FALLBACK[status]);
  return (
    <StatusBadge
      tone={TONE[status]}
      withDot
      pulse={status === 'submitted' || status === 'pending-submission'}
      data-testid={status === 'pending-submission' ? REGULATORY_WAITING_TEST_ID : undefined}
    >
      {label}
    </StatusBadge>
  );
}
