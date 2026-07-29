/**
 * Shipment Triage Strip (#1826)
 *
 * Cause-first warning banner shown above the `/shipments` table when ≥2
 * failed shipments on the loaded page, on the SAME connection, share a
 * normalised `errorMessage` (see `group-failed-shipments-by-cause.ts` —
 * grouping is keyed on `(connectionId, cause)`, not cause alone, so this
 * component can trust `group.connectionId` as the one connection every
 * member shipment shares). Leads with the source fix before Regenerate,
 * since a blind regenerate just re-fails until the shared root cause is
 * fixed at the connection.
 *
 * Copy is deliberately cause-neutral ("Review connection settings", not
 * "Fix sender address"): the grouping is a free-text match on
 * `errorMessage` (see the helper's own header comment on the
 * `providerCode`-not-persisted limitation), so the shared cause could be
 * anything a carrier rejects on — a bad sender address, an unsupported
 * parcel weight, a COD amount over the carrier's limit, etc. Naming a
 * specific fix here would be actively wrong advice whenever the real cause
 * isn't the one this issue's flagship example (a bad sender postcode)
 * happened to be. The actual cause text (raw, not normalised) is rendered
 * inline instead, so the operator knows what to look for once they land on
 * the connection.
 *
 * Admin/operator only — the strip's sole purpose is a write-adjacent jump
 * into connection settings, and its cause text is exactly the sensitive
 * carrier content gated for the `viewer` role, so it is hidden entirely
 * for viewer rather than shown redacted (see `ShipmentsPage`'s `canWrite` gate).
 *
 * @module apps/web/src/features/shipments/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { Alert } from '../../../shared/ui/alert';
import type { FailedShipmentCauseGroup } from '../lib/group-failed-shipments-by-cause';

interface ShipmentTriageStripProps {
  group: FailedShipmentCauseGroup;
}

export function ShipmentTriageStrip({ group }: ShipmentTriageStripProps): ReactElement {
  const count = group.shipments.length;
  // The raw (non-normalised) message from any member — they're not
  // byte-identical (digits/punctuation differ), but they read as the same
  // cause to an operator.
  const sampleReason = group.shipments[0].errorMessage;

  return (
    <Alert
      tone="warning"
      action={
        <Link to={`/connections/${group.connectionId}`} className="button button--secondary button--sm">
          Review connection settings
        </Link>
      }
    >
      <strong>
        {count} failed shipment{count === 1 ? '' : 's'} on this connection share one cause
      </strong>
      {sampleReason ? (
        <>
          {' '}
          — <span className="mono-text">{sampleReason}</span>
        </>
      ) : null}
      . Fix it at the connection once, then regenerate each. Regenerating first will just re-fail.
    </Alert>
  );
}
