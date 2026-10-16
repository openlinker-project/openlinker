/**
 * eparagony.pl Seller Section
 *
 * The seller's tax number, name and address, rendered at the top of the
 * eparagony.pl structured section whenever the connection has the invoicing
 * lane enabled. Before this, none of the three had a control: an operator who
 * enabled invoicing got a connection that refused every invoice, and the only
 * way to fix it was the raw Config JSON.
 *
 * Shown on the CAPABILITY, never on whether a value is already stored. Hiding a
 * filled section, or showing it only while it is empty, would leave an operator
 * no way to correct a wrong NIP - and a wrong NIP is refused by eparagony.pl
 * just as surely as a missing one.
 *
 * Collapsed into an `InlineDisclosure` like the other eparagony.pl groups, with
 * the readiness stated in the summary so a closed group still says whether
 * invoices will work. It starts OPEN in one case only: the tax number was
 * missing when the page loaded. That is the state in which every invoice fails,
 * and a closed group would ask the operator to find the problem behind a click.
 * The open state is decided once, at load, so typing never folds the group shut
 * under the operator's cursor.
 *
 * The address is one config object whose parts are edited as separate fields;
 * `eparagony-connection-config.ts` assembles it and refuses a half-filled one
 * inline, part by part.
 *
 * @module plugins/eparagony/components
 */
import { useState, type ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { InlineDisclosure } from '../../../shared/ui/inline-disclosure';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import type { StructuredConfigSectionProps } from '../../../shared/plugins';
import {
  SELLER_ADDRESS_FORM_FIELDS,
  readSellerReadiness,
  type SellerReadiness,
} from '../eparagony-seller';

const SELLER_FIELDS = [
  'eparagonyMerchantTIN',
  'eparagonyMerchantName',
  'eparagonyMerchantStreet',
  'eparagonyMerchantNumber',
  'eparagonyMerchantApartment',
  'eparagonyMerchantPostalCode',
  'eparagonyMerchantCity',
  'eparagonyMerchantCountry',
] as const;

type SellerField = (typeof SELLER_FIELDS)[number];

const ADDRESS_FIELDS: readonly SellerField[] = Object.values(SELLER_ADDRESS_FORM_FIELDS);

const ADDRESS_LEGEND_ID = 'eparagony-seller-address-legend';

const READINESS_NOTE: Record<Exclude<SellerReadiness, 'missing-tin'>, string> = {
  'invoices-only':
    'Invoices can be issued. A correction also needs the seller name and the full address.',
  complete: 'Invoices and corrections have everything they need.',
};

/**
 * The closed group's one line. Says the outcome rather than echoing every
 * field: the operator decides from it whether to open the group at all.
 */
function summaryFor(readiness: SellerReadiness, tin: string, problems: number): string {
  const base =
    readiness === 'missing-tin'
      ? 'No tax number, every invoice is refused'
      : readiness === 'invoices-only'
        ? `NIP ${tin}, incomplete for corrections`
        : `NIP ${tin}, complete`;
  if (problems === 0) return base;
  return `${base} (${problems} problem${problems === 1 ? '' : 's'} to fix)`;
}

type SellerSectionProps = Pick<
  StructuredConfigSectionProps,
  'form' | 'configIsParseable' | 'syncStructuredToJson'
>;

export function EparagonySellerSection({
  form,
  configIsParseable,
  syncStructuredToJson,
}: SellerSectionProps): ReactElement {
  const errors = form.formState.errors;
  // Watched field by field rather than `form.watch()` with no argument, which
  // would re-render this section on every keystroke anywhere in a long form.
  const watched = form.watch([...SELLER_FIELDS]);
  const readiness = readSellerReadiness(
    Object.fromEntries(SELLER_FIELDS.map((name, index) => [name, watched[index]]))
  );
  const [openAtLoad] = useState(() => readiness === 'missing-tin');
  const problems = SELLER_FIELDS.filter((name) => errors[name] !== undefined).length;
  const tin = (form.watch('eparagonyMerchantTIN') ?? '').trim();

  // The host form validates on submit and does not re-validate on change, so
  // the "Required." it put under an address part would stand after the
  // operator filled that part in. Re-checking the address while any of its
  // parts shows an error clears each one the moment it is fixed - and only
  // then, so an operator typing the first part of an address is not told the
  // rest is missing before they have had a chance to fill it.
  const addressShowsError = ADDRESS_FIELDS.some((name) => errors[name] !== undefined);

  function onFieldChange(name: SellerField, value: string): void {
    syncStructuredToJson(name, value);
    if (addressShowsError) void form.trigger([...ADDRESS_FIELDS]);
  }

  function field(name: SellerField, label: string, extra: Partial<FieldExtras> = {}): ReactElement {
    return (
      <FormField
        label={label}
        name={name}
        error={errors[name]?.message}
        description={extra.description}
      >
        <Input
          value={form.watch(name) ?? ''}
          onChange={(event) => onFieldChange(name, event.target.value)}
          placeholder={extra.placeholder}
          inputMode={extra.inputMode}
          autoComplete={extra.autoComplete ?? 'off'}
          disabled={!configIsParseable}
          invalid={Boolean(errors[name])}
        />
      </FormField>
    );
  }

  return (
    <InlineDisclosure
      className="eparagony-seller"
      label="Seller on invoices:"
      value={summaryFor(readiness, tin, problems)}
      defaultOpen={openAtLoad}
    >
      <div className="eparagony-seller__panel">
        <p className="form-field__description">
          eparagony.pl prints these on every invoice this connection issues, as the seller.
        </p>

        {readiness === 'missing-tin' ? (
          <Alert tone="warning" density="compact" data-testid="eparagony-seller-missing-tin">
            Every invoice from this connection is refused until you add the seller’s tax number.
          </Alert>
        ) : null}

        {field('eparagonyMerchantTIN', 'Tax number (NIP)', {
          description:
            'The NIP your eparagony.pl account is registered with. eparagony.pl refuses an invoice under any other number.',
          inputMode: 'numeric',
        })}

        {field('eparagonyMerchantName', 'Seller name', {
          description: 'The name as registered, for example the full company name.',
          autoComplete: 'organization',
        })}

        <fieldset className="eparagony-seller__address" aria-labelledby={ADDRESS_LEGEND_ID}>
          <legend className="form-field__label" id={ADDRESS_LEGEND_ID}>
            Seller address
          </legend>
          <div className="eparagony-seller__address-row eparagony-seller__address-row--street">
            {field('eparagonyMerchantStreet', 'Street', { placeholder: 'Prosta' })}
            {field('eparagonyMerchantNumber', 'Building', { placeholder: '51' })}
            {field('eparagonyMerchantApartment', 'Apartment')}
          </div>
          <div className="eparagony-seller__address-row eparagony-seller__address-row--city">
            {field('eparagonyMerchantPostalCode', 'Postal code', { placeholder: '00-838' })}
            {field('eparagonyMerchantCity', 'City', { placeholder: 'Warszawa' })}
            {field('eparagonyMerchantCountry', 'Country', { placeholder: 'PL' })}
          </div>
          <p className="form-field__description">
            Optional on an invoice. Leave it empty, or fill in every part except the apartment.
          </p>
        </fieldset>

        {readiness !== 'missing-tin' ? (
          <p
            className={`eparagony-seller__readiness eparagony-seller__readiness--${readiness}`}
            data-testid="eparagony-seller-readiness"
          >
            {READINESS_NOTE[readiness]}
          </p>
        ) : null}
      </div>
    </InlineDisclosure>
  );
}

interface FieldExtras {
  description: string;
  placeholder: string;
  inputMode: 'numeric' | 'text';
  autoComplete: string;
}
