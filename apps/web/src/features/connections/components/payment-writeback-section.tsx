/**
 * PaymentWritebackSection (#3963)
 *
 * One question per destination connection: when the buyer pays after the
 * order already reached this shop, mark it paid there, or leave it to the
 * operator? Rendered only for a connection that can be an order destination
 * (`OrderProcessorManager`), where the setting is read.
 *
 * Follows the `FulfilmentOwnershipSection` ordering rule: `form.setValue`
 * FIRST, then the host's whole-object serializer, which reads the form state.
 *
 * Matches `docs/plans/mockups/paid-writeback-to-destination.html`, state
 * `settings`.
 *
 * @module features/connections/components
 */
import type { ReactElement } from 'react';
import type { UseFormReturn } from 'react-hook-form';

import { useQuery } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { useMessages } from '../../../shared/i18n';
import { Select } from '../../../shared/ui/select';
import type { PaymentWritebackMode } from '../lib/payment-writeback-config';
import type { EditConnectionFormValues } from './edit-connection.schema';

/** Near-static per session, like the mapping option lists. */
const STATE_OPTIONS_STALE_TIME_MS = 10 * 60 * 1000;

export interface PaymentWritebackSectionProps {
  connectionId: string;
  form: UseFormReturn<EditConnectionFormValues>;
  /** When false, raw JSON is unparseable - the controls are disabled (divergence gate). */
  configIsParseable: boolean;
  /** Host whole-object serializer; called AFTER setValue. */
  syncPaymentWritebackToJson: () => void;
}

export function PaymentWritebackSection({
  connectionId,
  form,
  configIsParseable,
  syncPaymentWritebackToJson,
}: PaymentWritebackSectionProps): ReactElement {
  const value = form.watch('paymentWriteback') ?? { mode: 'mark-paid', paidStateId: '' };
  const apiClient = useApiClient();
  const copy = useMessages('connections').paymentWriteback;
  // The destination's own order statuses. Read through the API client rather
  // than the mappings feature, whose barrel already imports this one.
  const statesQuery = useQuery({
    queryKey: ['connections', connectionId, 'payment-writeback', 'order-statuses'],
    queryFn: () => apiClient.mappings.getMappingOptions(connectionId, 'destination', 'order-statuses'),
    staleTime: STATE_OPTIONS_STALE_TIME_MS,
  });
  const states = statesQuery.data ?? [];

  const update = (next: { mode: PaymentWritebackMode; paidStateId: string }): void => {
    form.setValue('paymentWriteback', next, { shouldDirty: true });
    syncPaymentWritebackToJson();
  };

  return (
    <section className="rate-limit-section payment-writeback-section" data-testid="payment-writeback-section">
      <h3 className="rate-limit-section__title">{copy.heading}</h3>
      <fieldset className="payment-writeback-section__options" disabled={!configIsParseable}>
        <legend className="sr-only">{copy.heading}</legend>
        <label className={`payment-writeback-section__option${value.mode === 'mark-paid' ? ' payment-writeback-section__option--on' : ''}`}>
          <input
            type="radio"
            name={`payment-writeback-${connectionId}`}
            checked={value.mode === 'mark-paid'}
            onChange={() => update({ mode: 'mark-paid', paidStateId: value.paidStateId })}
          />
          <span className="payment-writeback-section__body">
            <span className="payment-writeback-section__title">
              {copy.markPaid} <span className="payment-writeback-section__rec">{copy.recommended}</span>
            </span>
            {value.mode === 'mark-paid' && states.length > 0 ? (
              <span className="payment-writeback-section__field">
                <label htmlFor={`payment-writeback-state-${connectionId}`}>{copy.stateLabel}</label>
                <Select
                  id={`payment-writeback-state-${connectionId}`}
                  value={value.paidStateId}
                  onChange={(event) => update({ mode: 'mark-paid', paidStateId: event.target.value })}
                >
                  <option value="">{copy.stateDefault}</option>
                  {states.map((state) => (
                    <option key={state.value} value={state.value}>
                      {state.label}
                    </option>
                  ))}
                </Select>
                <span className="payment-writeback-section__hint">{copy.stateHelp}</span>
              </span>
            ) : null}
          </span>
        </label>
        <label className={`payment-writeback-section__option${value.mode === 'leave' ? ' payment-writeback-section__option--on' : ''}`}>
          <input
            type="radio"
            name={`payment-writeback-${connectionId}`}
            checked={value.mode === 'leave'}
            onChange={() => update({ mode: 'leave', paidStateId: value.paidStateId })}
          />
          <span className="payment-writeback-section__body">
            <span className="payment-writeback-section__title">{copy.leave}</span>
            <span className="payment-writeback-section__hint">{copy.leaveHelp}</span>
          </span>
        </label>
      </fieldset>
      <ul className="payment-writeback-section__facts">
        <li>{copy.factCod}</li>
        <li>{copy.factFailure}</li>
        <li>{copy.factFromNow}</li>
      </ul>
    </section>
  );
}
