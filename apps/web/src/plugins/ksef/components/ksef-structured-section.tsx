/**
 * KSeF Structured Section
 *
 * Plugin-owned structured-config inputs rendered inside `EditConnectionForm`
 * when the connection's `platformType` is `'ksef'`. Carries:
 *
 *   - Environment (`config.env`) — the C2 config-validator-gated field
 *   - Seller profile (`config.seller.{nip,name,address}`, #1223) — NIP,
 *     legal name, and postal address the adapter's `resolveSeller` reads.
 *   - Context identifier (`config.contextIdentifier`) — FE-additive context field
 *   - Payment defaults (`config.payment.*`, #1311) — default payment method,
 *     bank account, payment term, and early-payment discount emitted into the
 *     FA(3) `Platnosc` element. Manually entered (KSeF has no live
 *     bank-accounts API, unlike inFakt's #1303/#1308) — plain form fields, no
 *     live picker/query hook. Rendered as a flat continuation of this list
 *     (no `InlineDisclosure` wrapper — that primitive ships with #1308; wrap
 *     this block once it's merged, mirroring `infakt-structured-section.tsx`).
 *
 * Credentials (auth type + secret) are NOT edited here — they live in the
 * write-only `KsefCredentialsPanel`.
 *
 * @module plugins/ksef/components
 */
import type { ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import type { StructuredConfigSectionProps } from '../../../shared/plugins';
import {
  KSEF_ENVIRONMENT_VALUES,
  KSEF_FORMA_PLATNOSCI_VALUES,
  KSEF_LINE_UNIT_SUGGESTIONS,
} from './ksef-setup.schema';
import {
  KSEF_EXEMPTION_KIND_VALUES,
  KSEF_MARGIN_KIND_VALUES,
  KSEF_PLACEHOLDER_EXEMPTION_TEXT,
} from '../lib/ksef-annotations-config';
import { isStructurallyPlausibleNip, isValidNipChecksum, normalizeNip } from '../lib/ksef-nip';

const MARGIN_KIND_LABELS: Record<(typeof KSEF_MARGIN_KIND_VALUES)[number], string> = {
  'travel-services': 'Travel services (biura podróży)',
  'used-goods': 'Used goods (towary używane)',
  'works-of-art': 'Works of art (dzieła sztuki)',
  'collectors-items': "Collectors' items and antiques",
};

const EXEMPTION_KIND_LABELS: Record<(typeof KSEF_EXEMPTION_KIND_VALUES)[number], string> = {
  statute: 'Polish VAT act (P_19A)',
  directive: 'EU VAT directive (P_19B)',
  other: 'Other legal basis (P_19C)',
};

const ENVIRONMENT_LABELS: Record<(typeof KSEF_ENVIRONMENT_VALUES)[number], string> = {
  test: 'Test (sandbox)',
  demo: 'Demo (pre-production)',
  prod: 'Production (live clearance)',
};

const FORMA_PLATNOSCI_LABELS: Record<(typeof KSEF_FORMA_PLATNOSCI_VALUES)[number], string> = {
  '1': 'Gotówka (cash)',
  '2': 'Karta (card)',
  '3': 'Bon (voucher)',
  '4': 'Czek (cheque)',
  '5': 'Kredyt (credit)',
  '6': 'Przelew (bank transfer)',
  '7': 'Mobilna (mobile payment)',
};

export function KsefStructuredSection({
  form,
  configIsParseable,
  syncStructuredToJson,
}: StructuredConfigSectionProps): ReactElement {
  const nip = normalizeNip(form.watch('sellerNip') ?? '');
  // DEF-28: a valid checksum on an odd shape is worth a word, not a refusal.
  const nipLooksOdd = isValidNipChecksum(nip) && !isStructurallyPlausibleNip(nip);
  const marginScheme = form.watch('annMarginScheme') === 'true';
  const exemptionText = (form.watch('annExemptionText') ?? '').trim();
  const checkbox = (field: 'ksefAllowCrossBorder' | 'annCashAccounting' | 'annSelfBilling' | 'annMarginScheme') => ({
    checked: form.watch(field) === 'true',
    disabled: !configIsParseable,
    onChange: (event: { target: { checked: boolean } }) =>
      syncStructuredToJson(field, event.target.checked ? 'true' : ''),
  });
  return (
    <>
      <FormField
        label="Environment"
        name="ksefEnvironment"
        error={form.formState.errors.ksefEnvironment?.message}
        description="KSeF target environment (config.env). Production clears live invoices."
      >
        <Select
          value={form.watch('ksefEnvironment') ?? ''}
          onChange={(event) => syncStructuredToJson('ksefEnvironment', event.target.value)}
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.ksefEnvironment)}
        >
          <option value="" disabled>
            Select an environment…
          </option>
          {KSEF_ENVIRONMENT_VALUES.map((env) => (
            <option key={env} value={env}>
              {ENVIRONMENT_LABELS[env]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        label="Seller NIP"
        name="sellerNip"
        error={form.formState.errors.sellerNip?.message}
        description="10-digit Polish tax identifier of the issuing seller. Required to issue invoices."
      >
        <Input
          value={form.watch('sellerNip') ?? ''}
          onChange={(event) => syncStructuredToJson('sellerNip', event.target.value)}
          placeholder="1234567890"
          inputMode="numeric"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.sellerNip)}
        />
      </FormField>
      {nipLooksOdd ? (
        <Alert tone="warning" density="compact">
          This NIP passes the checksum but does not look like a typical NIP. Check it; KSeF decides
          when the first invoice is sent.
        </Alert>
      ) : null}
      <FormField
        label="Seller legal name"
        name="sellerName"
        error={form.formState.errors.sellerName?.message}
        description="Registered company name (Podmiot1) printed on the invoice. Required to issue."
      >
        <Input
          value={form.watch('sellerName') ?? ''}
          onChange={(event) => syncStructuredToJson('sellerName', event.target.value)}
          placeholder="ACME Sp. z o.o."
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.sellerName)}
        />
      </FormField>
      <FormField
        label="Address line 1"
        name="sellerAddressLine1"
        error={form.formState.errors.sellerAddressLine1?.message}
        description="Street and building number. Required to issue."
      >
        <Input
          value={form.watch('sellerAddressLine1') ?? ''}
          onChange={(event) => syncStructuredToJson('sellerAddressLine1', event.target.value)}
          placeholder="ul. Przykładowa 1"
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.sellerAddressLine1)}
        />
      </FormField>
      <FormField
        label="Address line 2"
        name="sellerAddressLine2"
        error={form.formState.errors.sellerAddressLine2?.message}
        description="Apartment, suite, or unit. Optional."
      >
        <Input
          value={form.watch('sellerAddressLine2') ?? ''}
          onChange={(event) => syncStructuredToJson('sellerAddressLine2', event.target.value)}
          placeholder="(optional)"
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.sellerAddressLine2)}
        />
      </FormField>
      <FormField
        label="City"
        name="sellerCity"
        error={form.formState.errors.sellerCity?.message}
        description="Required to issue."
      >
        <Input
          value={form.watch('sellerCity') ?? ''}
          onChange={(event) => syncStructuredToJson('sellerCity', event.target.value)}
          placeholder="Warszawa"
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.sellerCity)}
        />
      </FormField>
      <FormField
        label="Postal code"
        name="sellerPostalCode"
        error={form.formState.errors.sellerPostalCode?.message}
        description="Required to issue."
      >
        <Input
          value={form.watch('sellerPostalCode') ?? ''}
          onChange={(event) => syncStructuredToJson('sellerPostalCode', event.target.value)}
          placeholder="00-001"
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.sellerPostalCode)}
        />
      </FormField>
      <FormField
        label="Country"
        name="sellerCountryIso2"
        error={form.formState.errors.sellerCountryIso2?.message}
        description="ISO 3166-1 alpha-2 code. Defaults to PL."
      >
        <Input
          value={form.watch('sellerCountryIso2') ?? ''}
          onChange={(event) => syncStructuredToJson('sellerCountryIso2', event.target.value)}
          placeholder="PL"
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.sellerCountryIso2)}
        />
      </FormField>
      <FormField
        label="Context identifier"
        name="contextIdentifier"
        error={form.formState.errors.contextIdentifier?.message}
        description="Optional KSeF subject/context identifier when issuing on behalf of a sub-unit."
      >
        <Input
          value={form.watch('contextIdentifier') ?? ''}
          onChange={(event) => syncStructuredToJson('contextIdentifier', event.target.value)}
          placeholder="(optional)"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.contextIdentifier)}
        />
      </FormField>
      <FormField
        label="Default payment method"
        name="paymentFormaPlatnosci"
        error={form.formState.errors.paymentFormaPlatnosci?.message}
        description="Emitted as Platnosc/FormaPlatnosci. Optional — omit to leave payment info off issued invoices."
      >
        <Select
          value={form.watch('paymentFormaPlatnosci') ?? ''}
          onChange={(event) => syncStructuredToJson('paymentFormaPlatnosci', event.target.value)}
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.paymentFormaPlatnosci)}
        >
          <option value="">(not set)</option>
          {KSEF_FORMA_PLATNOSCI_VALUES.map((code) => (
            <option key={code} value={code}>
              {FORMA_PLATNOSCI_LABELS[code]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        label="Bank account number"
        name="paymentBankAccountNrRb"
        error={form.formState.errors.paymentBankAccountNrRb?.message}
        description="Emitted as Platnosc/RachunekBankowy/NrRB. Optional."
      >
        <Input
          value={form.watch('paymentBankAccountNrRb') ?? ''}
          onChange={(event) => syncStructuredToJson('paymentBankAccountNrRb', event.target.value)}
          placeholder="61 1090 1014 0000 0000 9999 9999"
          className="mono-text"
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.paymentBankAccountNrRb)}
        />
      </FormField>
      <FormField
        label="Bank name"
        name="paymentBankAccountBankName"
        error={form.formState.errors.paymentBankAccountBankName?.message}
        description="Emitted as Platnosc/RachunekBankowy/NazwaBanku. Optional."
      >
        <Input
          value={form.watch('paymentBankAccountBankName') ?? ''}
          onChange={(event) => syncStructuredToJson('paymentBankAccountBankName', event.target.value)}
          placeholder="(optional)"
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.paymentBankAccountBankName)}
        />
      </FormField>
      <FormField
        label="SWIFT"
        name="paymentBankAccountSwift"
        error={form.formState.errors.paymentBankAccountSwift?.message}
        description="Emitted as Platnosc/RachunekBankowy/SWIFT. Optional — for foreign-currency transfers."
      >
        <Input
          value={form.watch('paymentBankAccountSwift') ?? ''}
          onChange={(event) => syncStructuredToJson('paymentBankAccountSwift', event.target.value)}
          placeholder="(optional)"
          className="mono-text"
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.paymentBankAccountSwift)}
        />
      </FormField>
      <FormField
        label="Default payment term (days)"
        name="paymentTermDays"
        error={form.formState.errors.paymentTermDays?.message}
        description="Emitted as Platnosc/TerminPlatnosci/TerminOpis (days from the issue date). Optional; max 999."
      >
        <Input
          value={form.watch('paymentTermDays') ?? ''}
          onChange={(event) => syncStructuredToJson('paymentTermDays', event.target.value)}
          placeholder="14"
          inputMode="numeric"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.paymentTermDays)}
        />
      </FormField>
      <FormField
        label="Early-payment discount conditions"
        name="paymentSkontoConditions"
        error={form.formState.errors.paymentSkontoConditions?.message}
        description="Emitted as Platnosc/Skonto/WarunkiSkonta. Optional; required together with the discount amount."
      >
        <Input
          value={form.watch('paymentSkontoConditions') ?? ''}
          onChange={(event) => syncStructuredToJson('paymentSkontoConditions', event.target.value)}
          placeholder="e.g. paid within 7 days"
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.paymentSkontoConditions)}
        />
      </FormField>
      <FormField
        label="Early-payment discount amount"
        name="paymentSkontoAmount"
        error={form.formState.errors.paymentSkontoAmount?.message}
        description="Emitted as Platnosc/Skonto/WysokoscSkonta. Optional; required together with the discount conditions."
      >
        <Input
          value={form.watch('paymentSkontoAmount') ?? ''}
          onChange={(event) => syncStructuredToJson('paymentSkontoAmount', event.target.value)}
          placeholder="e.g. 2%"
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.paymentSkontoAmount)}
        />
      </FormField>
      <FormField
        label="Default line unit"
        name="invoiceDefaultLineUnit"
        error={form.formState.errors.invoiceDefaultLineUnit?.message}
        description="Unit of measure stamped on issued-invoice lines (config.invoiceDefaults.lineUnit). Clear it to omit the unit from documents."
      >
        <Input
          value={form.watch('invoiceDefaultLineUnit') ?? ''}
          onChange={(event) => syncStructuredToJson('invoiceDefaultLineUnit', event.target.value)}
          list="ksef-edit-line-unit-suggestions"
          placeholder="szt."
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.invoiceDefaultLineUnit)}
        />
      </FormField>
      {/* Outside FormField (it requires a single child); linked via list=. */}
      <datalist id="ksef-edit-line-unit-suggestions">
        {KSEF_LINE_UNIT_SUGGESTIONS.map((unit) => (
          <option key={unit} value={unit} />
        ))}
      </datalist>

      {/* DEF-18 / DEF-20 / DEF-22: the seller's tax treatment. OpenLinker
          suggests; each of these is the seller's own decision. */}
      <fieldset className="ksef-tax-treatment">
        <legend>Tax treatment</legend>
        <p className="text-muted">
          These describe your business, not a single sale. Every invoice from this connection starts
          from them; you can change any of them when issuing one by hand. OpenLinker does not decide
          what applies to you.
        </p>
        <label className="checkbox-row">
          <input type="checkbox" {...checkbox('annCashAccounting')} />
          <span>Cash accounting (metoda kasowa, P_16)</span>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" {...checkbox('annSelfBilling')} />
          <span>Self-billing (samofakturowanie, P_17)</span>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" {...checkbox('annMarginScheme')} />
          <span>Margin scheme (procedura marży)</span>
        </label>
        {marginScheme ? (
          <FormField label="Margin scheme kind" name="annMarginKind">
            <Select
              value={form.watch('annMarginKind') ?? ''}
              onChange={(event) => syncStructuredToJson('annMarginKind', event.target.value)}
              disabled={!configIsParseable}
            >
              <option value="">Used goods (default)</option>
              {KSEF_MARGIN_KIND_VALUES.map((kind) => (
                <option key={kind} value={kind}>
                  {MARGIN_KIND_LABELS[kind]}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}
        <FormField
          label="Exemption grounds cite"
          name="annExemptionKind"
          error={form.formState.errors.annExemptionKind?.message}
          description="Used on invoices with VAT-exempt (zw) lines."
        >
          <Select
            value={form.watch('annExemptionKind') ?? ''}
            onChange={(event) => syncStructuredToJson('annExemptionKind', event.target.value)}
            disabled={!configIsParseable}
            invalid={Boolean(form.formState.errors.annExemptionKind)}
          >
            <option value="">(not set)</option>
            {KSEF_EXEMPTION_KIND_VALUES.map((kind) => (
              <option key={kind} value={kind}>
                {EXEMPTION_KIND_LABELS[kind]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          label="Exemption grounds"
          name="annExemptionText"
          error={form.formState.errors.annExemptionText?.message}
          description="The provision you rely on, e.g. art. 113 ust. 1 ustawy o VAT. Up to 256 characters."
        >
          <Input
            value={form.watch('annExemptionText') ?? ''}
            onChange={(event) => syncStructuredToJson('annExemptionText', event.target.value)}
            placeholder="art. 43 ust. 1 pkt …"
            maxLength={256}
            autoComplete="off"
            disabled={!configIsParseable}
            invalid={Boolean(form.formState.errors.annExemptionText)}
          />
        </FormField>
        {exemptionText.length === 0 ? (
          <Alert tone="warning" density="compact">
            No exemption grounds are set. Invoices with exempt lines will cite the generic text "
            {KSEF_PLACEHOLDER_EXEMPTION_TEXT}", which names no provision.
          </Alert>
        ) : null}
        <label className="checkbox-row">
          <input type="checkbox" {...checkbox('ksefAllowCrossBorder')} />
          <span>
            Allow cross-border invoices
            <small className="text-muted" style={{ display: 'block' }}>
              OpenLinker cannot choose the WDT / export / OSS band for a foreign buyer by itself.
              Turn this on only if your catalogue already carries the right rate for those sales;
              without it such invoices are refused before sending.
            </small>
          </span>
        </label>
      </fieldset>
    </>
  );
}
