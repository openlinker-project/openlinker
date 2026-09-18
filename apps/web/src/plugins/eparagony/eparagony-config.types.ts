/**
 * eparagony.pl Connection-Config Types (#3266)
 *
 * The frontend's copy of the vendor vocabularies and adapter bounds the
 * connection form needs, as `as const` arrays plus the unions derived from them
 * - the documented pattern for a closed vocabulary. `apps/web` cannot import
 * `@openlinker/integrations-eparagony` (#591), so these are a mirror, and a
 * drifted mirror is not cosmetic here: the payment-form select would offer a
 * value the backend rejects, and the poll-timeout copy would state a clamp the
 * adapter does not apply - the "reported drifts from enforced" failure #2229
 * names. `scripts/check-eparagony-config-mirror.mjs` fails the build on drift,
 * following the four shipped mirror-guard precedents.
 *
 * @module plugins/eparagony
 */

/**
 * Payment forms the vendor accepts on `payment.payments[].paymentForm`.
 *
 * Mirrors `EparagonyPaymentFormValues`. ASCII, exactly as the backend union is -
 * the adapter's `EPARAGONY_PAYMENT_FORM_WIRE` map restores the diacritic
 * spelling on the way out, so the value this form round-trips is the ASCII one
 * and never the wire string.
 */
export const EPARAGONY_PAYMENT_FORM_VALUES = [
  'Gotowka',
  'Karta',
  'Czek',
  'Bon',
  'Inna',
  'Kredyt',
  'Waluta obca',
  'Przelew',
  'Mobilna',
  'Voucher',
] as const;

export type EparagonyPaymentFormValue = (typeof EPARAGONY_PAYMENT_FORM_VALUES)[number];

/**
 * Operator-facing labels. The vendor's own spelling is shown alongside an
 * English gloss, because the value is transmitted verbatim onto a fiscal
 * document - an operator matching it against their device's manual needs to see
 * the vendor's word, not our translation of it.
 */
export const EPARAGONY_PAYMENT_FORM_LABELS: Record<EparagonyPaymentFormValue, string> = {
  Gotowka: 'Gotówka (cash)',
  Karta: 'Karta (card)',
  Czek: 'Czek (cheque)',
  Bon: 'Bon (voucher)',
  Inna: 'Inna (other)',
  Kredyt: 'Kredyt (credit)',
  'Waluta obca': 'Waluta obca (foreign currency)',
  Przelew: 'Przelew (bank transfer)',
  Mobilna: 'Mobilna (mobile payment)',
  Voucher: 'Voucher',
};

/** The default the adapter's document mapper applies when the connection sets none. */
export const EPARAGONY_DEFAULT_PAYMENT_FORM: EparagonyPaymentFormValue = 'Przelew';

/**
 * The seven fiscal rate slots a Polish fiscal device exposes.
 *
 * Mirrors `EparagonyTaxRateCodeValues`. A receipt line carries the LETTER; what
 * each letter currently means is the seller's own device programming, which
 * OpenLinker cannot observe.
 */
export const EPARAGONY_TAX_RATE_CODE_VALUES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;

export type EparagonyTaxRateCodeValue = (typeof EPARAGONY_TAX_RATE_CODE_VALUES)[number];

/**
 * Poll-timeout clamp, mirroring `MIN_STATUS_POLL_TIMEOUT_MS` /
 * `MAX_STATUS_POLL_TIMEOUT_MS` / `DEFAULT_STATUS_POLL_TIMEOUT_MS` in
 * `eparagony-fiscalization.adapter.ts`.
 *
 * These are stated in the field's description, so they are a claim about
 * behaviour rather than decoration. They are deliberately NOT enforced as a form
 * bound: the backend validator accepts any positive number and the adapter
 * clamps, so a form that refused 120000 would be stricter than the gate (#2240)
 * and would tell the operator their value is invalid when it is merely clamped.
 */
export const EPARAGONY_POLL_TIMEOUT_MIN_MS = 5_000;
export const EPARAGONY_POLL_TIMEOUT_MAX_MS = 90_000;
export const EPARAGONY_POLL_TIMEOUT_DEFAULT_MS = 60_000;

/**
 * `statusPollTimeoutMs` is ONE config key read by TWO adapters, and the two
 * disagree on its default (#3192 review, I3 / #3268 review, I1). The
 * fiscalization (receipt) lane defaults to
 * {@link EPARAGONY_POLL_TIMEOUT_DEFAULT_MS} (60s); the invoicing lane - added
 * in a sibling PR, `eparagony-invoicing.adapter.ts` - deliberately keeps its
 * own, tighter default of 45s, because a receipt is registered on a device
 * while an invoice is composed and relayed, and one shared default would
 * silently re-budget one of the two lanes.
 *
 * Mirrors `DEFAULT_STATUS_POLL_TIMEOUT_MS` in `eparagony-invoicing.adapter.ts`
 * - checked by `check-eparagony-config-mirror.mjs` ONLY when that file
 * exists, since the invoicing lane may not have landed on this branch yet;
 * the value is hardcoded here rather than left undeclared so the field
 * description below can name it unconditionally, and the guard still catches
 * drift the moment both lanes are present on the same checkout.
 */
export const EPARAGONY_POLL_TIMEOUT_INVOICING_DEFAULT_MS = 45_000;

/**
 * The `print` field's three form states.
 *
 * Three rather than two because #2610's rule holds here as well: an operator's
 * explicit choice and an unset knob are different persisted states that must
 * round-trip apart. `'' `is absent, `'true'` is `print: true`, `'false'` is an
 * explicit `print: false`.
 *
 * What the copy must NOT hide is that *not set* and *don't print* produce the
 * same receipt today - the document mapper tests `config.print === true`, so
 * only the explicit `true` prints. Choosing *don't print* records the decision;
 * it does not change the outcome.
 */
export const EPARAGONY_PRINT_STATES = ['', 'true', 'false'] as const;

export type EparagonyPrintState = (typeof EPARAGONY_PRINT_STATES)[number];
