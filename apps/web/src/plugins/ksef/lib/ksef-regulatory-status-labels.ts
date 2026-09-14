/**
 * KSeF-branded Regulatory Status Labels (#3181)
 *
 * Provider-supplied override for the shared, regulator-neutral
 * `RegulatoryStatusBadge` (`features/invoicing`). `RegulatoryStatus` is
 * shared vocabulary across every `InvoicingPort` adapter — KSeF transmits
 * directly to Poland's national e-invoicing system, while inFakt and Subiekt
 * relay to it on the seller's behalf — so the shared component must not
 * assume the regulator is KSeF (ADR-026 country-agnostic design). This map
 * carries the KSeF-specific wording and is consumed ONLY by
 * `KsefInvoiceDetailSection`, the per-connection surface where "KSeF" is
 * genuinely the right word.
 *
 * @module plugins/ksef/lib
 */
import type { RegulatoryStatus } from '../../../features/invoicing';

/**
 * `Partial` and NOT `Record`: the badge is rendered only behind the panel's
 * `regulatoryStatus !== 'not-applicable'` gate, so that value never arrives —
 * an exhaustive `Record` would force this surface to state an opinion about a
 * status it never sees. The prop is `Partial` too, and the badge falls back to
 * the shared neutral label per status for any key omitted here.
 */
export const KSEF_REGULATORY_STATUS_LABELS: Partial<Record<RegulatoryStatus, string>> = {
  'pending-submission': 'KSeF: awaiting submission',
  submitted: 'KSeF: submitted',
  cleared: 'KSeF: clearing',
  accepted: 'KSeF: accepted',
  rejected: 'KSeF: rejected',
};
