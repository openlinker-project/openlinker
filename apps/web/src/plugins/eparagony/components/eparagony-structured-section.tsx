/**
 * eparagony.pl Structured Section (#3266)
 *
 * Plugin-owned structured-config inputs rendered inside `EditConnectionForm`
 * when the connection's `platformType` is `'eparagony'`. Before this, none of
 * these settings had a control anywhere in the product - an operator wanting a
 * paper receipt had to hand-edit the raw Config JSON.
 *
 * Four groups, only the first open. A single strip of eight controls is the
 * wrong shape for settings most operators touch once: the receipt fields are
 * what they came for, the rest is diagnosis and testing.
 *
 * `environment` and `posId` are NOT edited here - they belong to the guided
 * setup wizard. `taxRates` is deliberately absent and stays on the raw JSON
 * editor: it is the seller's physical device programming rather than a product's
 * VAT rate.
 *
 * Every control is disabled while the raw JSON is unparseable, because the host
 * serializer early-returns in that state and an enabled control would silently
 * discard the edit.
 *
 * @module plugins/eparagony/components
 */
import type { ReactElement } from 'react';
import { FormField } from '../../../shared/ui/form-field';
import { InlineDisclosure } from '../../../shared/ui/inline-disclosure';
import { Input } from '../../../shared/ui/input';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { Select } from '../../../shared/ui/select';
import type { StructuredConfigSectionProps } from '../../../shared/plugins';
import {
  EPARAGONY_DEFAULT_PAYMENT_FORM,
  EPARAGONY_PAYMENT_FORM_LABELS,
  EPARAGONY_PAYMENT_FORM_VALUES,
  EPARAGONY_POLL_TIMEOUT_DEFAULT_MS,
  EPARAGONY_POLL_TIMEOUT_MAX_MS,
  EPARAGONY_POLL_TIMEOUT_MIN_MS,
  EPARAGONY_TAX_RATE_CODE_VALUES,
  type EparagonyPaymentFormValue,
  type EparagonyPrintState,
} from '../eparagony-config.constants';
import { TAX_FALLBACK_FIELD_DESCRIPTION } from './eparagony-tax-fallback-copy';
import { EparagonyTaxFallbackInfotip } from './eparagony-tax-fallback-infotip';

const PRINT_OPTIONS: readonly { value: EparagonyPrintState; label: string }[] = [
  { value: '', label: 'Not set' },
  { value: 'true', label: 'Print' },
  { value: 'false', label: 'Do not print' },
];

const MS_PER_SECOND = 1000;

function seconds(ms: number): string {
  return `${ms / MS_PER_SECOND} s`;
}

export function EparagonyStructuredSection({
  form,
  configIsParseable,
  syncStructuredToJson,
}: StructuredConfigSectionProps): ReactElement {
  const printValue = (form.watch('eparagonyPrint') ?? '') as EparagonyPrintState;
  const taxSlot = form.watch('eparagonyDefaultTaxRateCode') ?? '';
  const pollTimeout = form.watch('eparagonyStatusPollTimeoutMs') ?? '';
  const deviceNumber = form.watch('eparagonyFiscalDeviceUniqueNumber') ?? '';
  const apiBaseUrl = form.watch('eparagonyApiBaseUrl') ?? '';
  const authBaseUrl = form.watch('eparagonyAuthBaseUrl') ?? '';

  const diagnosticsSummary =
    pollTimeout === '' && deviceNumber === '' ? 'Defaults' : 'Customised';
  const overridesSummary = apiBaseUrl === '' && authBaseUrl === '' ? 'None' : 'Custom hosts';

  return (
    <>
      <FormField
        label="Paper receipt"
        name="eparagonyPrint"
        error={form.formState.errors.eparagonyPrint?.message}
        description={
          'Asks eparagony.pl’s print service to also produce a paper receipt. An online sale ' +
          'has no counter and nobody waiting at one, so the default is no paper. “Not set” and ' +
          '“Do not print” produce the same receipt — picking “Do not print” records that it was ' +
          'a decision.'
        }
      >
        <SegmentedControl
          aria-label="Paper receipt"
          value={printValue}
          options={PRINT_OPTIONS.map((option) => ({
            ...option,
            // The group has no `disabled` prop of its own: disabling every
            // option is the primitive's documented way to lock it, and it keeps
            // arrow-navigation and the tab stop consistent.
            disabled: !configIsParseable,
          }))}
          onChange={(value) => syncStructuredToJson('eparagonyPrint', value)}
        />
      </FormField>

      <FormField
        label="Payment form on the receipt"
        name="eparagonyPaymentForm"
        error={form.formState.errors.eparagonyPaymentForm?.message}
        description={`How the payment is described on the receipt. Only the label is configurable — the amount is always the sale total. Defaults to ${EPARAGONY_DEFAULT_PAYMENT_FORM}, the honest description of a prepaid online order.`}
      >
        <Select
          value={form.watch('eparagonyPaymentForm') ?? ''}
          onChange={(event) => syncStructuredToJson('eparagonyPaymentForm', event.target.value)}
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.eparagonyPaymentForm)}
        >
          <option value="">Use the default ({EPARAGONY_DEFAULT_PAYMENT_FORM})</option>
          {EPARAGONY_PAYMENT_FORM_VALUES.map((value: EparagonyPaymentFormValue) => (
            <option key={value} value={value}>
              {EPARAGONY_PAYMENT_FORM_LABELS[value]}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField
        label="Payment name"
        name="eparagonyPaymentName"
        error={form.formState.errors.eparagonyPaymentName?.message}
        description="Optional free text describing the payment — a card scheme or payment provider, for example. Descriptive only."
      >
        <Input
          value={form.watch('eparagonyPaymentName') ?? ''}
          onChange={(event) => syncStructuredToJson('eparagonyPaymentName', event.target.value)}
          placeholder="Visa"
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.eparagonyPaymentName)}
        />
      </FormField>

      <InlineDisclosure
        label="Fallback tax rate:"
        value={taxSlot === '' ? 'Not set (recommended)' : `Slot ${taxSlot}`}
      >
        <FormField
          label="Fallback device slot"
          name="eparagonyDefaultTaxRateCode"
          error={form.formState.errors.eparagonyDefaultTaxRateCode?.message}
          // The infotip belongs to the DESCRIPTION, not the label. `FormField`
          // renders the label as `<label htmlFor>`, and a control's accessible
          // name is computed from that label's subtree - a button placed there
          // folds its own `aria-label` in, and the select ends up announced as
          // "Fallback device slot What the fallback tax rate does, and why it
          // is risky". `description` is wired through `aria-describedby`
          // instead, which is also where an explanation belongs.
          description={
            <>
              {TAX_FALLBACK_FIELD_DESCRIPTION} <EparagonyTaxFallbackInfotip />
            </>
          }
        >
          <Select
            value={taxSlot}
            onChange={(event) =>
              syncStructuredToJson('eparagonyDefaultTaxRateCode', event.target.value)
            }
            disabled={!configIsParseable}
            invalid={Boolean(form.formState.errors.eparagonyDefaultTaxRateCode)}
          >
            <option value="">Not set — refuse a line with no rate (recommended)</option>
            {EPARAGONY_TAX_RATE_CODE_VALUES.map((code) => (
              <option key={code} value={code}>
                Slot {code}
              </option>
            ))}
          </Select>
        </FormField>
      </InlineDisclosure>

      <InlineDisclosure label="Diagnostics and timing:" value={diagnosticsSummary}>
        <FormField
          label="Device wait time (ms)"
          name="eparagonyStatusPollTimeoutMs"
          error={form.formState.errors.eparagonyStatusPollTimeoutMs?.message}
          description={`How long to wait for the fiscal device to finish before the result is recorded as unknown. Defaults to ${seconds(EPARAGONY_POLL_TIMEOUT_DEFAULT_MS)}. Values outside ${seconds(EPARAGONY_POLL_TIMEOUT_MIN_MS)}–${seconds(EPARAGONY_POLL_TIMEOUT_MAX_MS)} are accepted and then brought into that range.`}
        >
          <Input
            value={pollTimeout}
            onChange={(event) =>
              syncStructuredToJson('eparagonyStatusPollTimeoutMs', event.target.value)
            }
            placeholder={String(EPARAGONY_POLL_TIMEOUT_DEFAULT_MS)}
            inputMode="numeric"
            disabled={!configIsParseable}
            invalid={Boolean(form.formState.errors.eparagonyStatusPollTimeoutMs)}
          />
        </FormField>

        <FormField
          label="Fiscal device number"
          name="eparagonyFiscalDeviceUniqueNumber"
          error={form.formState.errors.eparagonyFiscalDeviceUniqueNumber?.message}
          description="Diagnostic only. It is never sent on a receipt — eparagony.pl routes to the device itself. Filling it in lets “Test connection” also report whether the device has been seen alive."
        >
          <Input
            value={deviceNumber}
            onChange={(event) =>
              syncStructuredToJson('eparagonyFiscalDeviceUniqueNumber', event.target.value)
            }
            placeholder="ABC123456890"
            autoComplete="off"
            disabled={!configIsParseable}
            invalid={Boolean(form.formState.errors.eparagonyFiscalDeviceUniqueNumber)}
          />
        </FormField>
      </InlineDisclosure>

      <InlineDisclosure label="Testing overrides:" value={overridesSummary}>
        <FormField
          label="API host"
          name="eparagonyApiBaseUrl"
          error={form.formState.errors.eparagonyApiBaseUrl?.message}
          description="For testing only. Leave empty so the environment chosen during setup decides the host. Must be https."
        >
          <Input
            value={apiBaseUrl}
            onChange={(event) => syncStructuredToJson('eparagonyApiBaseUrl', event.target.value)}
            placeholder="https://sandbox.eparagony.pl"
            autoComplete="off"
            disabled={!configIsParseable}
            invalid={Boolean(form.formState.errors.eparagonyApiBaseUrl)}
          />
        </FormField>

        <FormField
          label="Sign-in host"
          name="eparagonyAuthBaseUrl"
          error={form.formState.errors.eparagonyAuthBaseUrl?.message}
          description="For testing only. Leave empty so the environment chosen during setup decides the host. Must be https."
        >
          <Input
            value={authBaseUrl}
            onChange={(event) => syncStructuredToJson('eparagonyAuthBaseUrl', event.target.value)}
            placeholder="https://login.sandbox.eparagony.pl"
            autoComplete="off"
            disabled={!configIsParseable}
            invalid={Boolean(form.formState.errors.eparagonyAuthBaseUrl)}
          />
        </FormField>
      </InlineDisclosure>
    </>
  );
}
