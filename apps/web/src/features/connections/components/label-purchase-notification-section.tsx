/**
 * LabelPurchaseNotificationSection (#4097)
 *
 * The one checkbox behind `config.shipping.notifyMarketplaceOnLabelPurchase`:
 * buying a label also tells the shop or marketplace the order shipped. Rendered
 * only for carrier connections (`ShippingProviderManager`), the only place the
 * dispatch service reads it. Default is off: buying a label and handing the
 * parcel over are two different acts, and the copy says so.
 *
 * Follows the `FulfilmentOwnershipSection` ordering rule: `form.setValue` FIRST,
 * then the host's whole-object serializer, which reads the form state.
 *
 * @module features/connections/components
 */
import type { ReactElement } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { useMessages } from '../../../shared/i18n';
import type { EditConnectionFormValues } from './edit-connection.schema';

export interface LabelPurchaseNotificationSectionProps {
  form: UseFormReturn<EditConnectionFormValues>;
  /** When false, raw JSON is unparseable - the checkbox is disabled (divergence gate). */
  configIsParseable: boolean;
  /** When false, the session cannot write connections - the checkbox shows its value, disabled. */
  canWrite: boolean;
  /** Host whole-object serializer; called AFTER setValue. */
  syncLabelPurchaseNotificationToJson: () => void;
}

export function LabelPurchaseNotificationSection({
  form,
  configIsParseable,
  canWrite,
  syncLabelPurchaseNotificationToJson,
}: LabelPurchaseNotificationSectionProps): ReactElement {
  const copy = useMessages('connections').labelPurchaseNotificationSection;
  const checked = form.watch('notifyOnLabelPurchase') === true;

  const handleChange = (next: boolean): void => {
    form.setValue('notifyOnLabelPurchase', next, { shouldDirty: true });
    syncLabelPurchaseNotificationToJson();
  };

  return (
    <section className="rate-limit-section" data-testid="label-purchase-notification-section">
      <h3 className="rate-limit-section__title">{copy.heading}</h3>
      <label className="rate-limit-section__toggle">
        <input
          type="checkbox"
          checked={checked}
          disabled={!configIsParseable || !canWrite}
          data-testid="notify-on-label-purchase-checkbox"
          onChange={(event) => handleChange(event.target.checked)}
        />
        <span>{copy.toggle}</span>
      </label>
      <p className="rate-limit-section__help">{copy.help}</p>
      <p className="rate-limit-section__help">{copy.manualDispatch}</p>
    </section>
  );
}
