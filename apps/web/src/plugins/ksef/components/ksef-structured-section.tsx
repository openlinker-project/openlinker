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
import { interpolate } from '../../../shared/i18n';
import { useKsefMessages } from '../messages';


export function KsefStructuredSection({
  form,
  configIsParseable,
  syncStructuredToJson,
}: StructuredConfigSectionProps): ReactElement {
  const messages = useKsefMessages();
  const copy = messages.ksefStructuredSection;
  const fields = messages.common.fields;
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
        label={fields.environment.label}
        name="ksefEnvironment"
        error={form.formState.errors.ksefEnvironment?.message}
        description={copy.environment.description}
      >
        <Select
          value={form.watch('ksefEnvironment') ?? ''}
          onChange={(event) => syncStructuredToJson('ksefEnvironment', event.target.value)}
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.ksefEnvironment)}
        >
          <option value="" disabled>
            {copy.environment.placeholder}
          </option>
          {KSEF_ENVIRONMENT_VALUES.map((env) => (
            <option key={env} value={env}>
              {messages.common.environments[env]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        label={fields.sellerNip.label}
        name="sellerNip"
        error={form.formState.errors.sellerNip?.message}
        description={fields.sellerNip.description}
      >
        <Input
          value={form.watch('sellerNip') ?? ''}
          onChange={(event) => syncStructuredToJson('sellerNip', event.target.value)}
          placeholder={fields.sellerNip.placeholder}
          inputMode="numeric"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.sellerNip)}
        />
      </FormField>
      {nipLooksOdd ? (
        <Alert tone="warning" density="compact">
          {copy.nipLooksOdd}
        </Alert>
      ) : null}
      <FormField
        label={fields.sellerName.label}
        name="sellerName"
        error={form.formState.errors.sellerName?.message}
        description={fields.sellerName.description}
      >
        <Input
          value={form.watch('sellerName') ?? ''}
          onChange={(event) => syncStructuredToJson('sellerName', event.target.value)}
          placeholder={fields.sellerName.placeholder}
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.sellerName)}
        />
      </FormField>
      <FormField
        label={fields.addressLine1.label}
        name="sellerAddressLine1"
        error={form.formState.errors.sellerAddressLine1?.message}
        description={fields.addressLine1.description}
      >
        <Input
          value={form.watch('sellerAddressLine1') ?? ''}
          onChange={(event) => syncStructuredToJson('sellerAddressLine1', event.target.value)}
          placeholder={fields.addressLine1.placeholder}
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.sellerAddressLine1)}
        />
      </FormField>
      <FormField
        label={fields.addressLine2.label}
        name="sellerAddressLine2"
        error={form.formState.errors.sellerAddressLine2?.message}
        description={fields.addressLine2.description}
      >
        <Input
          value={form.watch('sellerAddressLine2') ?? ''}
          onChange={(event) => syncStructuredToJson('sellerAddressLine2', event.target.value)}
          placeholder={fields.optional}
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.sellerAddressLine2)}
        />
      </FormField>
      <FormField
        label={fields.city.label}
        name="sellerCity"
        error={form.formState.errors.sellerCity?.message}
        description={fields.city.description}
      >
        <Input
          value={form.watch('sellerCity') ?? ''}
          onChange={(event) => syncStructuredToJson('sellerCity', event.target.value)}
          placeholder={fields.city.placeholder}
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.sellerCity)}
        />
      </FormField>
      <FormField
        label={fields.postalCode.label}
        name="sellerPostalCode"
        error={form.formState.errors.sellerPostalCode?.message}
        description={fields.postalCode.description}
      >
        <Input
          value={form.watch('sellerPostalCode') ?? ''}
          onChange={(event) => syncStructuredToJson('sellerPostalCode', event.target.value)}
          placeholder={fields.postalCode.placeholder}
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.sellerPostalCode)}
        />
      </FormField>
      <FormField
        label={fields.country.label}
        name="sellerCountryIso2"
        error={form.formState.errors.sellerCountryIso2?.message}
        description={fields.country.description}
      >
        <Input
          value={form.watch('sellerCountryIso2') ?? ''}
          onChange={(event) => syncStructuredToJson('sellerCountryIso2', event.target.value)}
          placeholder={fields.country.placeholder}
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.sellerCountryIso2)}
        />
      </FormField>
      <FormField
        label={fields.contextIdentifier.label}
        name="contextIdentifier"
        error={form.formState.errors.contextIdentifier?.message}
        description={copy.contextIdentifier.description}
      >
        <Input
          value={form.watch('contextIdentifier') ?? ''}
          onChange={(event) => syncStructuredToJson('contextIdentifier', event.target.value)}
          placeholder={fields.optional}
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.contextIdentifier)}
        />
      </FormField>
      <FormField
        label={copy.paymentMethod.label}
        name="paymentFormaPlatnosci"
        error={form.formState.errors.paymentFormaPlatnosci?.message}
        description={copy.paymentMethod.description}
      >
        <Select
          value={form.watch('paymentFormaPlatnosci') ?? ''}
          onChange={(event) => syncStructuredToJson('paymentFormaPlatnosci', event.target.value)}
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.paymentFormaPlatnosci)}
        >
          <option value="">{copy.notSet}</option>
          {KSEF_FORMA_PLATNOSCI_VALUES.map((code) => (
            <option key={code} value={code}>
              {messages.common.formaPlatnosci[code]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        label={copy.bankAccount.label}
        name="paymentBankAccountNrRb"
        error={form.formState.errors.paymentBankAccountNrRb?.message}
        description={copy.bankAccount.description}
      >
        <Input
          value={form.watch('paymentBankAccountNrRb') ?? ''}
          onChange={(event) => syncStructuredToJson('paymentBankAccountNrRb', event.target.value)}
          placeholder={copy.bankAccount.placeholder}
          className="mono-text"
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.paymentBankAccountNrRb)}
        />
      </FormField>
      <FormField
        label={copy.bankName.label}
        name="paymentBankAccountBankName"
        error={form.formState.errors.paymentBankAccountBankName?.message}
        description={copy.bankName.description}
      >
        <Input
          value={form.watch('paymentBankAccountBankName') ?? ''}
          onChange={(event) => syncStructuredToJson('paymentBankAccountBankName', event.target.value)}
          placeholder={fields.optional}
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.paymentBankAccountBankName)}
        />
      </FormField>
      <FormField
        label={copy.swift.label}
        name="paymentBankAccountSwift"
        error={form.formState.errors.paymentBankAccountSwift?.message}
        description={copy.swift.description}
      >
        <Input
          value={form.watch('paymentBankAccountSwift') ?? ''}
          onChange={(event) => syncStructuredToJson('paymentBankAccountSwift', event.target.value)}
          placeholder={fields.optional}
          className="mono-text"
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.paymentBankAccountSwift)}
        />
      </FormField>
      <FormField
        label={copy.paymentTerm.label}
        name="paymentTermDays"
        error={form.formState.errors.paymentTermDays?.message}
        description={copy.paymentTerm.description}
      >
        <Input
          value={form.watch('paymentTermDays') ?? ''}
          onChange={(event) => syncStructuredToJson('paymentTermDays', event.target.value)}
          placeholder={copy.paymentTerm.placeholder}
          inputMode="numeric"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.paymentTermDays)}
        />
      </FormField>
      <FormField
        label={copy.skontoConditions.label}
        name="paymentSkontoConditions"
        error={form.formState.errors.paymentSkontoConditions?.message}
        description={copy.skontoConditions.description}
      >
        <Input
          value={form.watch('paymentSkontoConditions') ?? ''}
          onChange={(event) => syncStructuredToJson('paymentSkontoConditions', event.target.value)}
          placeholder={copy.skontoConditions.placeholder}
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.paymentSkontoConditions)}
        />
      </FormField>
      <FormField
        label={copy.skontoAmount.label}
        name="paymentSkontoAmount"
        error={form.formState.errors.paymentSkontoAmount?.message}
        description={copy.skontoAmount.description}
      >
        <Input
          value={form.watch('paymentSkontoAmount') ?? ''}
          onChange={(event) => syncStructuredToJson('paymentSkontoAmount', event.target.value)}
          placeholder={copy.skontoAmount.placeholder}
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.paymentSkontoAmount)}
        />
      </FormField>
      <FormField
        label={fields.lineUnit.label}
        name="invoiceDefaultLineUnit"
        error={form.formState.errors.invoiceDefaultLineUnit?.message}
        description={copy.lineUnit.description}
      >
        <Input
          value={form.watch('invoiceDefaultLineUnit') ?? ''}
          onChange={(event) => syncStructuredToJson('invoiceDefaultLineUnit', event.target.value)}
          list="ksef-edit-line-unit-suggestions"
          placeholder={fields.lineUnit.placeholder}
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
        <legend>{copy.taxTreatment.legend}</legend>
        <p className="text-muted">{copy.taxTreatment.intro}</p>
        <label className="checkbox-row">
          <input type="checkbox" {...checkbox('annCashAccounting')} />
          <span>{copy.taxTreatment.cashAccounting}</span>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" {...checkbox('annSelfBilling')} />
          <span>{copy.taxTreatment.selfBilling}</span>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" {...checkbox('annMarginScheme')} />
          <span>{copy.taxTreatment.marginScheme}</span>
        </label>
        {marginScheme ? (
          <FormField label={copy.marginKind.label} name="annMarginKind">
            <Select
              value={form.watch('annMarginKind') ?? ''}
              onChange={(event) => syncStructuredToJson('annMarginKind', event.target.value)}
              disabled={!configIsParseable}
            >
              <option value="">{copy.marginKind.default}</option>
              {KSEF_MARGIN_KIND_VALUES.map((kind) => (
                <option key={kind} value={kind}>
                  {copy.marginKind.options[kind]}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}
        <FormField
          label={copy.exemptionKind.label}
          name="annExemptionKind"
          error={form.formState.errors.annExemptionKind?.message}
          description={copy.exemptionKind.description}
        >
          <Select
            value={form.watch('annExemptionKind') ?? ''}
            onChange={(event) => syncStructuredToJson('annExemptionKind', event.target.value)}
            disabled={!configIsParseable}
            invalid={Boolean(form.formState.errors.annExemptionKind)}
          >
            <option value="">{copy.notSet}</option>
            {KSEF_EXEMPTION_KIND_VALUES.map((kind) => (
              <option key={kind} value={kind}>
                {copy.exemptionKind.options[kind]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          label={copy.exemptionText.label}
          name="annExemptionText"
          error={form.formState.errors.annExemptionText?.message}
          description={copy.exemptionText.description}
        >
          <Input
            value={form.watch('annExemptionText') ?? ''}
            onChange={(event) => syncStructuredToJson('annExemptionText', event.target.value)}
            placeholder={copy.exemptionText.placeholder}
            maxLength={256}
            autoComplete="off"
            disabled={!configIsParseable}
            invalid={Boolean(form.formState.errors.annExemptionText)}
          />
        </FormField>
        {exemptionText.length === 0 ? (
          <Alert tone="warning" density="compact">
            {interpolate(copy.exemptionText.missing, { text: KSEF_PLACEHOLDER_EXEMPTION_TEXT })}
          </Alert>
        ) : null}
        <label className="checkbox-row">
          <input type="checkbox" {...checkbox('ksefAllowCrossBorder')} />
          <span>
            {copy.crossBorder.label}
            <small className="text-muted" style={{ display: 'block' }}>
              {copy.crossBorder.description}
            </small>
          </span>
        </label>
      </fieldset>
    </>
  );
}
