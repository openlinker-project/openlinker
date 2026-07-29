/**
 * Shipment Severity Label (#1826)
 *
 * Renders the derived per-row severity word (Fix / Finish / Send / View) for
 * the `/shipments` Action column and the mobile card summary. Colour is
 * reinforcement only — the word itself is the signal, so the label survives
 * colour-blindness and greyscale printing.
 *
 * The screen-reader context ("Suggested action: …") is a visually-hidden text
 * prefix rather than an `aria-label` on the `<span>`: `aria-label` on a
 * generic-role element is not reliably exposed by assistive tech, whereas real
 * text always is.
 *
 * Permission note (#1826, deliberate): `canWrite` here comes from
 * `usePermission('shipments:write')`, NOT `useWriteAccess` (#1615). That means
 * this flow's write affordances are absent — not disabled-with-tooltip — for a
 * public-demo read-only viewer. The plan (§7 of
 * `docs/plans/implementation-plan-shipments-inline-retry.md`) chose that
 * deliberately, because the carrier `errorMessage` these affordances sit
 * beside is itself role-redacted server-side. Do not "fix" this by swapping in
 * `useWriteAccess` without revisiting that decision.
 *
 * @module apps/web/src/features/shipments/components
 */
import type { ReactElement } from 'react';

import type { Shipment } from '../api/shipments.types';
import { deriveSeverityLabel } from '../lib/shipment-severity';

interface ShipmentSeverityLabelProps {
  shipment: Shipment;
  /** `usePermission('shipments:write')` — a viewer always reads `View`. */
  canWrite: boolean;
}

export function ShipmentSeverityLabel({
  shipment,
  canWrite,
}: ShipmentSeverityLabelProps): ReactElement {
  const severity = deriveSeverityLabel(shipment, canWrite);
  return (
    // Class name kept page-prefixed: the styling rule predates this component
    // and is shared with nothing else, so renaming it would be churn in
    // `index.css` for no behavioural gain.
    <span className="shipments-page__severity" data-severity={severity}>
      <span className="sr-only">Suggested action: </span>
      {/* Own element so a test/query can target the visible word alone,
          without the screen-reader prefix bleeding into its text content. */}
      <span>{severity}</span>
    </span>
  );
}
