/**
 * PaymentMethodsSection (#3775)
 *
 * Lets an operator say what the payment modules their shop's orders carry mean
 * (`config.paymentMethodMap`, #3774). Rows are the modules recent orders used
 * plus any already in the stored map, so a saved mapping for a module not seen
 * lately is listed instead of being dropped by the next save.
 *
 * Every state is distinct: loading, a failed read (never rendered as "no
 * modules"), an integration that ignores the map, a connection that could not
 * be asked, and a genuinely empty window.
 *
 * Follows the `FulfilmentOwnershipSection` ordering rule: `form.setValue`
 * FIRST, then the host's whole-object serializer.
 *
 * @module features/connections/components
 */
import type { ReactElement } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { Alert } from '../../../shared/ui/alert';
import { Select } from '../../../shared/ui/select';
import { formatDateTime } from '../../../shared/format/format-date';
import { useObservedPaymentMethodsQuery } from '../hooks/use-observed-payment-methods-query';
import type { ObservedPaymentMethod } from '../api/connections.types';
import {
  MAPPABLE_PAYMENT_METHODS,
  isMappablePaymentMethod,
  type PaymentMethodChoice,
} from '../lib/payment-method-map';
import { PAYMENT_METHODS_COPY, PAYMENT_METHOD_LABELS } from '../lib/payment-methods.copy';
import type { EditConnectionFormValues } from './edit-connection.schema';

export interface PaymentMethodsSectionProps {
  form: UseFormReturn<EditConnectionFormValues>;
  connectionId: string;
  /** When false, raw JSON is unparseable - the selects are disabled (divergence gate). */
  configIsParseable: boolean;
  /** Without `connections:write` the mapping is shown read-only. */
  canWrite: boolean;
  /** Host whole-object serializer; called AFTER setValue. */
  syncPaymentMethodMapToJson: () => void;
}

interface Row {
  id: string;
  observed: ObservedPaymentMethod | null;
}

function methodLabel(method: string): string {
  return isMappablePaymentMethod(method) ? PAYMENT_METHOD_LABELS[method] : method;
}

export function PaymentMethodsSection({
  form,
  connectionId,
  configIsParseable,
  canWrite,
  syncPaymentMethodMapToJson,
}: PaymentMethodsSectionProps): ReactElement {
  const query = useObservedPaymentMethodsQuery(connectionId);
  const map = (form.watch('paymentMethodMap') ?? {}) as Record<string, PaymentMethodChoice>;
  const disabled = !configIsParseable || !canWrite;

  const handleChange = (id: string, value: string): void => {
    const next: Record<string, string> = { ...(form.getValues('paymentMethodMap') ?? {}) };
    next[id] = value;
    form.setValue('paymentMethodMap', next, { shouldDirty: true });
    syncPaymentMethodMapToJson();
  };

  return (
    <section className="rate-limit-section" data-testid="payment-methods-section">
      <h3 className="rate-limit-section__title">{PAYMENT_METHODS_COPY.heading}</h3>
      <p className="rate-limit-section__help">{PAYMENT_METHODS_COPY.intro}</p>
      {renderBody()}
    </section>
  );

  function renderBody(): ReactElement {
    if (query.isLoading) {
      return <p className="rate-limit-section__help">{PAYMENT_METHODS_COPY.loading}</p>;
    }
    if (query.isError || !query.data) {
      return (
        <Alert tone="warning" title="Payment modules unavailable">
          {PAYMENT_METHODS_COPY.readFailed}
        </Alert>
      );
    }

    const { mapSupport, windowDays, items } = query.data;
    if (mapSupport === 'unsupported') {
      return <p className="rate-limit-section__help">{PAYMENT_METHODS_COPY.unsupported}</p>;
    }

    const observedById = new Map(items.map((item) => [item.sourcePaymentMethod, item]));
    const rows: Row[] = [
      ...items.map((item) => ({ id: item.sourcePaymentMethod, observed: item })),
      ...Object.keys(map)
        .filter((id) => !observedById.has(id))
        .map((id) => ({ id, observed: null })),
    ];

    return (
      <>
        {mapSupport === 'unknown' ? (
          <Alert tone="warning" title="Connection not reached">
            {PAYMENT_METHODS_COPY.unreachable}
          </Alert>
        ) : null}
        {rows.length === 0 ? (
          <p className="rate-limit-section__help">{PAYMENT_METHODS_COPY.empty(windowDays)}</p>
        ) : (
          <ul className="payment-methods-section__list" data-testid="payment-methods-rows">
            {rows.map((row) => renderRow(row, windowDays))}
          </ul>
        )}
        <p className="rate-limit-section__help">{PAYMENT_METHODS_COPY.codNote}</p>
      </>
    );
  }

  function renderRow({ id, observed }: Row, windowDays: number): ReactElement {
    const platformMethod = observed?.platformMethod ?? null;
    const definedByPlatform = platformMethod !== null && platformMethod !== 'unknown';
    return (
      <li key={id} className="payment-methods-section__row" data-testid={`payment-method-row-${id}`}>
        <div className="payment-methods-section__summary">
          <strong>{id}</strong>{' '}
          {observed ? (
            <span className="rate-limit-section__help">
              {PAYMENT_METHODS_COPY.ordersCount(observed.orderCount)},{' '}
              {PAYMENT_METHODS_COPY.lastSeen} {formatDateTime(observed.lastSeenAt)}
            </span>
          ) : (
            <span className="rate-limit-section__help">
              {PAYMENT_METHODS_COPY.notSeen(windowDays)}
            </span>
          )}
        </div>
        {definedByPlatform ? (
          <p className="rate-limit-section__help">
            {PAYMENT_METHODS_COPY.platformDefined(methodLabel(platformMethod))}
          </p>
        ) : (
          <Select
            aria-label={PAYMENT_METHODS_COPY.selectLabel(id)}
            value={map[id] ?? ''}
            disabled={disabled}
            data-testid={`payment-method-select-${id}`}
            onChange={(event) => handleChange(id, event.target.value)}
          >
            <option value="">{PAYMENT_METHODS_COPY.notSet}</option>
            {MAPPABLE_PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </option>
            ))}
          </Select>
        )}
      </li>
    );
  }
}
