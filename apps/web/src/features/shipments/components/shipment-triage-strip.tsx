/**
 * Shipment Triage Strip (#1826)
 *
 * Descriptive banner shown above the `/shipments` table when ≥2 failed
 * shipments on the loaded page, on the SAME connection, report the same
 * normalised `errorMessage` (see `group-failed-shipments-by-cause.ts` —
 * grouping is keyed on `(connectionId, cause)`, not cause alone, so this
 * component can trust `group.connectionId` as the one connection every member
 * shipment shares).
 *
 * The copy states an OBSERVATION, never a causal claim. It deliberately does
 * not say the failures "share one cause", nor that regenerating "will just
 * re-fail": the grouping is a free-text match on a message the backend admits
 * is often a generic validation error (see the helper's header comment), so
 * the members may well be a bad postcode, a missing parcel template and an
 * over-limit COD sitting under one string. And for an exhausted-retry 429/5xx
 * the "don't regenerate" advice is exactly inverted — regenerating is the fix.
 * Naming a specific remedy here would be actively wrong advice most of the
 * time; the raw cause text is rendered inline instead so the operator can
 * judge for themselves.
 *
 * Scope is honest about being page-local: the caller passes only the rows
 * currently loaded (one page), so the count is a page count, not a global one.
 * The secondary link filters `/shipments` to every failed row on the
 * connection, which is how the operator sees the rest.
 *
 * Admin/operator only — its cause text is exactly the sensitive carrier
 * content gated for the `viewer` role, so it is hidden entirely for viewer
 * rather than shown redacted (see `ShipmentsPage`'s permission gate).
 *
 * Permission note (#1826, deliberate): the two permissions here are distinct
 * and must stay distinct. Rendering the strip at all follows
 * `shipments:write`; editing the connection is `connections:write`, which is
 * why `canReviewConnection` is a separate prop rather than reusing the flag
 * that gates Regenerate. Neither uses `useWriteAccess` (#1615) — see the note
 * in `shipment-severity-label.tsx` for why that relaxation was declined here.
 *
 * @module apps/web/src/features/shipments/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { Alert } from '../../../shared/ui/alert';
import type { FailedShipmentCauseGroup } from '../lib/group-failed-shipments-by-cause';

export interface ShipmentTriageStripProps {
  group: FailedShipmentCauseGroup;
  /** Resolved display name of `group.connectionId`; null when unresolvable. */
  connectionName: string | null;
  /** Holder of `connections:write` - NOT `shipments:write`. Gates the settings CTA. */
  canReviewConnection: boolean;
}

export function ShipmentTriageStrip({
  group,
  connectionName,
  canReviewConnection,
}: ShipmentTriageStripProps): ReactElement {
  const count = group.shipments.length;
  // The raw (non-normalised) message from any member — they're not
  // byte-identical (digits/punctuation differ), but they read as the same
  // message to an operator.
  const sampleReason = group.shipments[0].errorMessage;
  const connectionLabel = connectionName ?? 'this connection';

  return (
    <Alert
      tone="warning"
      action={
        <>
          {canReviewConnection ? (
            <Link
              to={`/connections/${group.connectionId}`}
              className="button button--secondary button--sm"
            >
              Review connection settings
            </Link>
          ) : null}
          <Link
            to={`/shipments?status=failed&connectionId=${group.connectionId}`}
            className="button button--sm"
          >
            Show all failed on this connection
          </Link>
        </>
      }
    >
      <strong>
        {count} failed shipment{count === 1 ? '' : 's'} on {connectionLabel} report the same
        carrier message
      </strong>
      {sampleReason ? (
        <>
          {' '}
          - <span className="mono-text">{sampleReason}</span>
        </>
      ) : null}
      . Counted across the shipments loaded on this page only. If the cause is a connection-level
      setting, fixing it once saves regenerating each one.
    </Alert>
  );
}
