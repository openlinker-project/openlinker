/**
 * Shipment Triage Strip (#1826, re-keyed #1918, narrowed #2873)
 *
 * Descriptive banner shown above the `/shipments` table when ≥2 failed
 * shipments on the loaded page, on the SAME connection, report the same
 * `providerCode` — or, absent one, the same normalised `errorMessage` (see
 * `group-failed-shipments-by-cause.ts` — grouping is keyed on
 * `(connectionId, cause)`, not cause alone, so this component can trust
 * `group.connectionId` as the one connection every member shipment shares).
 *
 * When `group.providerCode` is EXACT (`isExactProviderCode` — its family is
 * one this app can classify) the grouping is an HONEST shared-cause claim,
 * and `deriveRetryabilityClass` lets the copy give concrete guidance (e.g.
 * "safe to just retry" for a `'transient'` code). Otherwise the copy stays an
 * OBSERVATION, never a causal claim — the grouping is a free-text match on a
 * message the backend admits is often a generic validation error, so the
 * members may well be a bad postcode, a missing parcel template and an
 * over-limit COD sitting under one string; naming a specific remedy there
 * would be actively wrong advice most of the time, so the raw cause text is
 * rendered inline instead so the operator can judge for themselves.
 *
 * #2873: the branch is keyed on EXACTNESS, not on `providerCode !== null`.
 * #2805 made `InpostHttpClient` fall back to ShipX's own bucket code
 * (`shipx.validation_failed`) when the carrier sends no field-level details,
 * so a null-check would have flipped exactly these groups onto the
 * shared-rejection-code branch and stopped rendering the carrier message —
 * trading the operator's only actionable signal for a code that narrows
 * nothing. A coarse code is instead rendered ALONGSIDE the message, labelled
 * with its own `'unknown'` retryability class so the strip says plainly that
 * it does not classify the cause.
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
import {
  isExactProviderCode,
  type FailedShipmentCauseGroup,
} from '../lib/group-failed-shipments-by-cause';
import { deriveRetryabilityClass, RETRYABILITY_LABEL } from '../lib/shipment-retryability';

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
  // Whether the group was keyed on the code ALONE. A coarse code was composed
  // with the normalised message instead, so it is the message that held the
  // group together and the copy must say so.
  const codeIsExact = isExactProviderCode(group.providerCode);
  // Computed for either branch: on the exact branch it is the concrete
  // guidance, on the coarse branch it is always `'unknown'` and is what makes
  // the strip admit the code narrows nothing. Absent a code entirely there is
  // nothing to classify, so no retryability wording is implied at all.
  const retryabilityClass =
    group.providerCode !== null ? deriveRetryabilityClass(group.providerCode) : null;

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
        {count} failed shipment{count === 1 ? '' : 's'} on {connectionLabel} report the same{' '}
        {codeIsExact ? 'rejection code' : 'carrier message'}
      </strong>
      {codeIsExact ? (
        <>
          {' '}
          - <span className="mono-text">{group.providerCode}</span>
          {retryabilityClass ? <> ({RETRYABILITY_LABEL[retryabilityClass]})</> : null}
        </>
      ) : (
        <>
          {sampleReason ? (
            <>
              {' '}
              - <span className="mono-text">{sampleReason}</span>
            </>
          ) : null}
          {/* On this branch `retryabilityClass` is always `'unknown'` by
              construction (`isExactProviderCode` tested exactly that), so the
              only real question is whether there is a code to show at all. */}
          {group.providerCode !== null ? (
            <>
              {' '}
              (carrier code <span className="mono-text">{group.providerCode}</span> -{' '}
              {RETRYABILITY_LABEL.unknown})
            </>
          ) : null}
        </>
      )}
      . Counted across the shipments loaded on this page only. If the cause is a connection-level
      setting, fixing it once saves regenerating each one.
    </Alert>
  );
}
