/**
 * Order Edit Refusal (#3544, mockup M1 `edit-blocked`)
 *
 * Why an edit was refused and what to do about it. **The server's own sentence is
 * the reason**; the code decides the title, the numbered remedy and the page
 * control the remedy points at (Packing for a packed order, Sales document for
 * an issued one, Shipment for a bought label). When the page predicted the
 * refusal before any call, `reason` is the fallback copy for that code.
 *
 * A remedy button asks the page to scroll to the control rather than doing the
 * remedy itself: unpacking and correcting a document are existing controls with
 * their own confirmations, and a second path to them would be a second thing to
 * keep right.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  ORDER_EDIT_REFUSAL_COPY,
  type OrderEditErrorCode,
  type OrderEditRemedyTarget,
} from '../lib/order-edit';

export interface OrderEditRefusalProps {
  code: OrderEditErrorCode;
  /** The server's sentence; falls back to the code's own copy. */
  reason?: string | null;
  /** Sections already saved before this refusal, so the operator knows what stuck. */
  savedSectionLabels?: readonly string[];
  onGoTo?: (target: OrderEditRemedyTarget) => void;
}

export function OrderEditRefusal({
  code,
  reason,
  savedSectionLabels = [],
  onGoTo,
}: OrderEditRefusalProps): ReactElement {
  const copy = ORDER_EDIT_REFUSAL_COPY[code];
  const remedy = copy.remedy;
  const lockedWholeOrder = copy.locks.length >= 4;

  return (
    <Alert
      tone="warning"
      title={copy.title}
      data-testid="order-edit-blocked"
      action={
        remedy !== null && onGoTo ? (
          <Button
            type="button"
            tone="secondary"
            className="button--sm"
            data-testid="order-edit-blocked-remedy"
            onClick={() => {
              onGoTo(remedy.target);
            }}
          >
            {remedy.label}
          </Button>
        ) : undefined
      }
    >
      <p>{reason && reason.trim() !== '' ? reason : copy.fallbackReason}</p>
      {copy.steps.length > 0 ? (
        <ol className="order-cancel-list" data-testid="order-edit-blocked-steps">
          {copy.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      {code === 'SALES_DOCUMENT_ISSUED' || lockedWholeOrder ? (
        <p className="muted-text">
          Or cancel the order and ask the buyer to order again.
        </p>
      ) : null}
      {savedSectionLabels.length > 0 ? (
        <p data-testid="order-edit-blocked-saved">
          {`Already saved: ${savedSectionLabels.join(', ').toLowerCase()}.`}
        </p>
      ) : null}
    </Alert>
  );
}
