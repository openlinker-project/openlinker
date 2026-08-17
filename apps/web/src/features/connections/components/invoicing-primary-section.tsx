/**
 * InvoicingPrimarySection (#2047)
 *
 * Marks a connection as the one that auto-issues an order's invoice —
 * `config.invoicing.isPrimary`.
 *
 * CAPABILITY-GATED, NOT PLATFORM-GATED. Every other structured section in this
 * feature is keyed to a platform (`subiekt*`, `infakt*`, `inpost*`); this one is
 * keyed to the `Invoicing` capability, because KSeF / inFakt / Subiekt are
 * alternative routes for the SAME document rather than three different features.
 * A rule about "which of my invoicing connections issues" cannot live in any one
 * provider's section without being invisible from the other two.
 *
 * WHY IT EXISTS AT ALL: without an editor, an install with two invoicing
 * connections and no primary stops auto-invoicing entirely (the trigger issues
 * nothing rather than issuing twice) and the only remedy is a hand-written
 * config PATCH. `stockSafetyBuffer` / `pricingRule` are precedent for shipping
 * core config without a control, but those tune a value; this one switches a
 * whole flow off, so the operator needs to be able to switch it back on.
 *
 * @module features/connections/components
 */
import type { ReactElement } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { EditConnectionFormValues } from './edit-connection.schema';

export interface InvoicingPrimarySectionProps {
  form: UseFormReturn<EditConnectionFormValues>;
  /** When false, raw JSON is unparseable — the input is disabled (divergence gate). */
  configIsParseable: boolean;
  /** Host whole-object serializer; called AFTER setValue (ordering trap — see RateLimitSection). */
  syncInvoicingPrimaryToJson: () => void;
  /**
   * How many ACTIVE connections have `Invoicing` enabled, this one included.
   * Drives the help text only: with a single connection the flag is inert (the
   * trigger issues on the lone candidate regardless), and saying so stops an
   * operator from believing they have to set it.
   */
  invoicingConnectionCount: number;
}

export function InvoicingPrimarySection({
  form,
  configIsParseable,
  syncInvoicingPrimaryToJson,
  invoicingConnectionCount,
}: InvoicingPrimarySectionProps): ReactElement {
  const isPrimary = form.watch('invoicingIsPrimary') ?? false;
  const isOnlyCandidate = invoicingConnectionCount <= 1;

  const handleChange = (checked: boolean): void => {
    // ORDERING TRAP: write the form field FIRST, then re-serialize — the sync
    // function reads CURRENT form state via getValues.
    form.setValue('invoicingIsPrimary', checked, { shouldDirty: true });
    syncInvoicingPrimaryToJson();
  };

  return (
    <section className="rate-limit-section">
      <h3 className="rate-limit-section__title">Automatic invoicing</h3>
      <p className="rate-limit-section__help">
        {isOnlyCandidate ? (
          <>
            This is the only connection that can issue invoices, so it auto-issues whether or not
            it is marked primary. The setting starts to matter as soon as you add a second one.
          </>
        ) : (
          <>
            One sale is one invoice, so exactly one connection may auto-issue it. With several
            invoicing connections and <strong>no</strong> primary — or more than one — OpenLinker
            issues <strong>nothing</strong> rather than issuing twice, and every order has to be
            invoiced by hand.
          </>
        )}
      </p>

      <label className="rate-limit-section__toggle">
        <input
          type="checkbox"
          checked={isPrimary}
          disabled={!configIsParseable}
          onChange={(event) => handleChange(event.target.checked)}
        />
        <span>Auto-issue invoices on this connection</span>
      </label>

      {isPrimary && !isOnlyCandidate ? (
        <p className="rate-limit-section__help">
          Marking another connection primary as well is the same as marking none: the ambiguity
          makes OpenLinker issue nothing. Clear this one before you set the other.
        </p>
      ) : null}
    </section>
  );
}
