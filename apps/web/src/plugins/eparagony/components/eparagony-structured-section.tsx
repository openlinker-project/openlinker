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
 * VAT rate. Contributing a section also puts that editor behind the host's
 * "Show raw config JSON" toggle, which it was not before (`hasStructuredInputs`
 * in `EditConnectionForm`), so the fallback group SAYS where `taxRates` went -
 * it is the more dangerous of the two keys, and leaving it one silent click
 * further away would be the wrong trade (#3268 review).
 *
 * Every control is disabled while the raw JSON is unparseable, because the host
 * serializer early-returns in that state and an enabled control would silently
 * discard the edit.
 *
 * @module plugins/eparagony/components
 */
import { useMemo, type ReactElement } from 'react';
import { FieldError } from '../../../shared/ui/field-error';
import { FormField } from '../../../shared/ui/form-field';
import { InlineDisclosure } from '../../../shared/ui/inline-disclosure';
import { Infotip } from '../../../shared/ui/infotip';
import { Input } from '../../../shared/ui/input';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { Select } from '../../../shared/ui/select';
import type { StructuredConfigSectionProps } from '../../../shared/plugins';
import {
  EPARAGONY_DEFAULT_PAYMENT_FORM,
  EPARAGONY_PAYMENT_FORM_LABELS,
  EPARAGONY_PAYMENT_FORM_VALUES,
  EPARAGONY_POLL_TIMEOUT_DEFAULT_MS,
  EPARAGONY_POLL_TIMEOUT_INVOICING_DEFAULT_MS,
  EPARAGONY_POLL_TIMEOUT_MAX_MS,
  EPARAGONY_POLL_TIMEOUT_MIN_MS,
  EPARAGONY_TAX_RATE_CODE_VALUES,
  type EparagonyPaymentFormValue,
  type EparagonyPrintState,
} from '../eparagony-config.types';
import {
  readUnrecognisedEnumValue,
  readUnrecognisedPrintValue,
} from '../eparagony-connection-config';
import {
  EPARAGONY_TAX_FALLBACK_HAZARD_NOTES,
  TAX_FALLBACK_FIELD_DESCRIPTION,
  TAX_FALLBACK_INFOTIP_LABEL,
} from './eparagony-tax-fallback-copy';

const PRINT_OPTIONS: readonly { value: EparagonyPrintState; label: string }[] = [
  { value: '', label: 'Not set' },
  { value: 'true', label: 'Print' },
  { value: 'false', label: 'Do not print' },
];

const PRINT_DESCRIPTION_ID = 'eparagonyPrint-description';
const PRINT_ERROR_ID = 'eparagonyPrint-error';

const MS_PER_SECOND = 1000;

function seconds(ms: number): string {
  return `${ms / MS_PER_SECOND} s`;
}

/**
 * Append a problem count to a collapsed group's summary.
 *
 * Five of the eight fields sit inside a native `<details>` that starts closed,
 * and `FormErrorSummary` renders bare message strings with no field name and no
 * anchor - so a bad value in a collapsed group produces a message at the top of
 * the page and an apparently empty form below it (`docs/lessons.md`). Naming the
 * count in the summary is what tells the operator which group to open. Opening
 * the group automatically would need a controlled `InlineDisclosure`.
 */
function summarise(value: string, problems: number): string {
  if (problems === 0) return value;
  return `${value} — ${problems} problem${problems === 1 ? '' : 's'} to fix`;
}

/**
 * The stored value of a closed-vocabulary key this build does not recognise.
 *
 * Read from the LIVE `configText` rather than `connection.config`, so the
 * warning disappears the moment the operator picks a real value instead of
 * standing until the page is reloaded. Unparseable JSON means there is nothing
 * to report - the host already locks every control in that state.
 */
function useUnrecognisedValues(configText: string): {
  print: string | null;
  paymentForm: string | null;
  defaultTaxRateCode: string | null;
} {
  return useMemo(() => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(configText) as unknown;
    } catch {
      return { print: null, paymentForm: null, defaultTaxRateCode: null };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { print: null, paymentForm: null, defaultTaxRateCode: null };
    }
    const config = parsed as Record<string, unknown>;
    return {
      print: readUnrecognisedPrintValue(config),
      paymentForm: readUnrecognisedEnumValue(
        config,
        'paymentForm',
        EPARAGONY_PAYMENT_FORM_VALUES,
      ),
      defaultTaxRateCode: readUnrecognisedEnumValue(
        config,
        'defaultTaxRateCode',
        EPARAGONY_TAX_RATE_CODE_VALUES,
      ),
    };
  }, [configText]);
}

export function EparagonyStructuredSection({
  connection,
  form,
  configIsParseable,
  syncStructuredToJson,
}: StructuredConfigSectionProps): ReactElement {
  // `statusPollTimeoutMs` is ONE config key, read by TWO adapters with two
  // different defaults once the invoicing lane is enabled on this connection
  // (#3192 review, I3 / #3268 review, I1) — stating only the receipt-lane
  // default would be a false claim about what the field does on a dual-role
  // connection.
  const invoicingEnabled = connection.enabledCapabilities.includes('Invoicing');
  const pollTimeoutDescription = invoicingEnabled
    ? `How long to wait for the fiscal device or the invoicing provider to finish before ` +
      `the result is recorded as unknown. Defaults to ${seconds(EPARAGONY_POLL_TIMEOUT_DEFAULT_MS)} ` +
      `for e-receipts, ${seconds(EPARAGONY_POLL_TIMEOUT_INVOICING_DEFAULT_MS)} for e-invoices. ` +
      `Values outside ${seconds(EPARAGONY_POLL_TIMEOUT_MIN_MS)}–${seconds(EPARAGONY_POLL_TIMEOUT_MAX_MS)} ` +
      `are accepted and then brought into that range.`
    : `How long to wait for the fiscal device to finish before the result is recorded as ` +
      `unknown. Defaults to ${seconds(EPARAGONY_POLL_TIMEOUT_DEFAULT_MS)}. Values outside ` +
      `${seconds(EPARAGONY_POLL_TIMEOUT_MIN_MS)}–${seconds(EPARAGONY_POLL_TIMEOUT_MAX_MS)} are ` +
      `accepted and then brought into that range.`;
  const printValue = (form.watch('eparagonyPrint') ?? '') as EparagonyPrintState;
  const taxSlot = form.watch('eparagonyDefaultTaxRateCode') ?? '';
  const pollTimeout = form.watch('eparagonyStatusPollTimeoutMs') ?? '';
  const deviceNumber = form.watch('eparagonyFiscalDeviceUniqueNumber') ?? '';
  const apiBaseUrl = form.watch('eparagonyApiBaseUrl') ?? '';
  const authBaseUrl = form.watch('eparagonyAuthBaseUrl') ?? '';

  const unrecognised = useUnrecognisedValues(form.watch('configText') ?? '');

  const errors = form.formState.errors;
  const printError = errors.eparagonyPrint?.message;

  const fallbackProblems = errors.eparagonyDefaultTaxRateCode ? 1 : 0;
  const diagnosticsProblems =
    (errors.eparagonyStatusPollTimeoutMs ? 1 : 0) +
    (errors.eparagonyFiscalDeviceUniqueNumber ? 1 : 0);
  const overrideProblems =
    (errors.eparagonyApiBaseUrl ? 1 : 0) + (errors.eparagonyAuthBaseUrl ? 1 : 0);

  const fallbackSummary =
    taxSlot === ''
      ? 'Not set — a line with no rate is refused'
      : `Slot ${taxSlot} — used when a line has no rate`;
  const diagnosticsSummary = pollTimeout === '' && deviceNumber === '' ? 'Defaults' : 'Customised';
  const overridesSummary =
    apiBaseUrl === '' && authBaseUrl === ''
      ? 'Using the environment’s own hosts'
      : 'Overriding the environment’s hosts';

  return (
    <>
      {/*
        Rendered as `.form-field` markup directly rather than through
        `FormField`, which clones `id` onto its single child and points a
        `<label htmlFor>` at it. `SegmentedControl` spreads onto a
        `<div role="radiogroup">`, and a div is not a labelable element - the
        `for` association silently does nothing, so clicking the visible label
        moves no focus and the group ends up named twice (#3268 review). Both
        shipped `SegmentedControl`-in-a-form precedents avoid `FormField` for
        exactly this: `features/orders/components/generate-label-form.tsx` and
        `features/returns/components/return-dispose-form.tsx`.
      */}
      <div className="form-field">
        <span className="form-field__label" id="eparagonyPrint-label">
          Paper receipt
        </span>
        <p className="form-field__description" id={PRINT_DESCRIPTION_ID}>
          {unrecognised.print === null
            ? 'Asks eparagony.pl’s print service to also produce a paper receipt. An online sale has no counter and nobody waiting at one, so the default is no paper. “Not set” and “Do not print” produce the same receipt — picking “Do not print” records that it was a decision.'
            : // Same treatment as paymentForm / defaultTaxRateCode below: never
              // render an unrecognised stored value as one of the three real
              // states, and never leave the operator to discover the refusal
              // only as an opaque 400 on save (#3268 review).
              `The saved value (${unrecognised.print}) is not true or false, so saving this connection will be refused until you pick one below.`}
        </p>
        <SegmentedControl
          aria-labelledby="eparagonyPrint-label"
          aria-describedby={PRINT_DESCRIPTION_ID}
          aria-invalid={printError ? true : undefined}
          aria-errormessage={printError ? PRINT_ERROR_ID : undefined}
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
        <FieldError id={PRINT_ERROR_ID} message={printError} />
      </div>

      <FormField
        label="Payment form on the receipt"
        name="eparagonyPaymentForm"
        error={errors.eparagonyPaymentForm?.message}
        description={
          unrecognised.paymentForm === null
            ? `How the payment is described on the receipt. Only the label is configurable — the amount is always the sale total. Defaults to ${EPARAGONY_DEFAULT_PAYMENT_FORM}, the honest description of a prepaid online order.`
            : // Never render an unrecognised stored value as a known one: the
              // select's DISPLAYED value is the raw stored string itself (see
              // the hidden sentinel `<option>` below), not "Use the default" -
              // so this is the one place the copy can say "pick one below"
              // unqualified again. Re-selecting the recommended option is a
              // genuine value change now, not a no-op (#3311).
              `The saved value (${unrecognised.paymentForm}) is not one eparagony.pl accepts, so saving this connection will be refused until you pick one below.`
        }
      >
        <Select
          value={unrecognised.paymentForm ?? (form.watch('eparagonyPaymentForm') ?? '')}
          onChange={(event) => syncStructuredToJson('eparagonyPaymentForm', event.target.value)}
          disabled={!configIsParseable}
          invalid={Boolean(errors.eparagonyPaymentForm)}
        >
          {/*
            When the stored value is unrecognised, this hidden sentinel option
            - not "Use the default" - is the one actually selected in the DOM
            (see the `value` prop above). That is what makes re-picking "Use
            the default" a REAL value change: a browser only fires `onChange`
            when the selected option differs from what was already selected,
            and pinning the select to the recommended option up front made
            re-clicking it a no-op click that fired nothing (#3311). `hidden`
            keeps it out of the dropdown list; `disabled` keeps it from ever
            being reselected once the operator has moved off it.
          */}
          {unrecognised.paymentForm !== null && (
            <option value={unrecognised.paymentForm} hidden disabled>
              {unrecognised.paymentForm} (not recognised)
            </option>
          )}
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
        error={errors.eparagonyPaymentName?.message}
        description="Optional free text describing the payment — a card scheme or payment provider, for example. Descriptive only."
      >
        <Input
          value={form.watch('eparagonyPaymentName') ?? ''}
          onChange={(event) => syncStructuredToJson('eparagonyPaymentName', event.target.value)}
          placeholder="Visa"
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(errors.eparagonyPaymentName)}
        />
      </FormField>

      <InlineDisclosure
        label="Fallback tax rate:"
        value={summarise(fallbackSummary, fallbackProblems)}
      >
        <FormField
          label="Fallback device slot"
          name="eparagonyDefaultTaxRateCode"
          error={errors.eparagonyDefaultTaxRateCode?.message}
          // The infotip belongs to the DESCRIPTION, not the label. `FormField`
          // renders the label as `<label htmlFor>`, and a control's accessible
          // name is computed from that label's subtree - a button placed there
          // folds its own `aria-label` in, and the select ends up announced as
          // "Fallback device slot What the fallback tax rate does, and why it
          // is risky". `description` is wired through `aria-describedby`
          // instead, which is also where an explanation belongs.
          description={
            <>
              {unrecognised.defaultTaxRateCode === null
                ? TAX_FALLBACK_FIELD_DESCRIPTION
                : // Same fix as `paymentForm` above: the select's DISPLAYED
                  // value is the raw stored string (the hidden sentinel
                  // option below), not "Not set", so re-picking the
                  // recommended option is a genuine value change rather than
                  // a no-op click (#3311) and the copy can say "pick one
                  // below" unqualified again.
                  `The saved value (${unrecognised.defaultTaxRateCode}) is not a slot this fiscal device exposes, so saving this connection will be refused until you pick one below.`}{' '}
              <Infotip
                ariaLabel={TAX_FALLBACK_INFOTIP_LABEL}
                definitions={EPARAGONY_TAX_FALLBACK_HAZARD_NOTES}
              />
            </>
          }
        >
          <Select
            value={unrecognised.defaultTaxRateCode ?? taxSlot}
            onChange={(event) =>
              syncStructuredToJson('eparagonyDefaultTaxRateCode', event.target.value)
            }
            disabled={!configIsParseable}
            invalid={Boolean(errors.eparagonyDefaultTaxRateCode)}
          >
            {/* See the identical sentinel on `paymentForm` above for why this exists (#3311). */}
            {unrecognised.defaultTaxRateCode !== null && (
              <option value={unrecognised.defaultTaxRateCode} hidden disabled>
                {unrecognised.defaultTaxRateCode} (not recognised)
              </option>
            )}
            <option value="">Not set — refuse a line with no rate (recommended)</option>
            {EPARAGONY_TAX_RATE_CODE_VALUES.map((code) => (
              <option key={code} value={code}>
                Slot {code}
              </option>
            ))}
          </Select>
        </FormField>

        {/*
          What each slot letter MEANS on the seller's own device is the
          `taxRates` table, which has no control here on purpose - it is device
          programming, not a product's VAT rate. Naming it is not optional
          politeness: left unconfigured the adapter assumes the standard Polish
          layout, and a device programmed differently registers real sales under
          the wrong rate with no error at all.
        */}
        <p className="form-field__description">
          What each slot means on your device is the <code>taxRates</code> table, which has no
          field here — it is device programming rather than a product’s VAT rate. Edit it under
          “Show raw config JSON” below. Left unset, eparagony.pl assumes the standard Polish slots.
        </p>
      </InlineDisclosure>

      <InlineDisclosure
        label="Diagnostics and timing:"
        value={summarise(diagnosticsSummary, diagnosticsProblems)}
      >
        <FormField
          label="Device wait time (ms)"
          name="eparagonyStatusPollTimeoutMs"
          error={errors.eparagonyStatusPollTimeoutMs?.message}
          description={pollTimeoutDescription}
        >
          <Input
            value={pollTimeout}
            onChange={(event) =>
              syncStructuredToJson('eparagonyStatusPollTimeoutMs', event.target.value)
            }
            placeholder={String(EPARAGONY_POLL_TIMEOUT_DEFAULT_MS)}
            inputMode="numeric"
            disabled={!configIsParseable}
            invalid={Boolean(errors.eparagonyStatusPollTimeoutMs)}
          />
        </FormField>

        <FormField
          label="Fiscal device number"
          name="eparagonyFiscalDeviceUniqueNumber"
          error={errors.eparagonyFiscalDeviceUniqueNumber?.message}
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
            invalid={Boolean(errors.eparagonyFiscalDeviceUniqueNumber)}
          />
        </FormField>
      </InlineDisclosure>

      <InlineDisclosure
        label="Testing overrides:"
        value={summarise(overridesSummary, overrideProblems)}
      >
        <FormField
          label="API host"
          name="eparagonyApiBaseUrl"
          error={errors.eparagonyApiBaseUrl?.message}
          description="For testing only. Leave empty so the environment chosen during setup decides the host. Must be https."
        >
          <Input
            value={apiBaseUrl}
            onChange={(event) => syncStructuredToJson('eparagonyApiBaseUrl', event.target.value)}
            placeholder="https://sandbox.eparagony.pl"
            autoComplete="off"
            disabled={!configIsParseable}
            invalid={Boolean(errors.eparagonyApiBaseUrl)}
          />
        </FormField>

        <FormField
          label="Sign-in host"
          name="eparagonyAuthBaseUrl"
          error={errors.eparagonyAuthBaseUrl?.message}
          description="For testing only. Leave empty so the environment chosen during setup decides the host. Must be https."
        >
          <Input
            value={authBaseUrl}
            onChange={(event) => syncStructuredToJson('eparagonyAuthBaseUrl', event.target.value)}
            placeholder="https://login.sandbox.eparagony.pl"
            autoComplete="off"
            disabled={!configIsParseable}
            invalid={Boolean(errors.eparagonyAuthBaseUrl)}
          />
        </FormField>
      </InlineDisclosure>
    </>
  );
}
