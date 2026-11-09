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
import { interpolate, usePlural, type PluralFn } from '../../../shared/i18n';
import { useEparagonyMessages } from '../messages';

type SellerSectionCopy = ReturnType<typeof useEparagonyMessages>['eparagonySellerSection'];

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

/**
 * The closed group's one line. Says the outcome rather than echoing every
 * field: the operator decides from it whether to open the group at all.
 */
function summaryFor(
  copy: SellerSectionCopy,
  plural: PluralFn,
  readiness: SellerReadiness,
  tin: string,
  problems: number,
): string {
  const base =
    readiness === 'missing-tin'
      ? copy.summary.missingTin
      : readiness === 'invoices-only'
        ? interpolate(copy.summary.invoicesOnly, { tin })
        : interpolate(copy.summary.complete, { tin });
  if (problems === 0) return base;
  return plural(problems, copy.summary.withProblems, { summary: base });
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
  const copy = useEparagonyMessages().eparagonySellerSection;
  const plural = usePlural();
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
      label={copy.label}
      value={summaryFor(copy, plural, readiness, tin, problems)}
      defaultOpen={openAtLoad}
    >
      <div className="eparagony-seller__panel">
        <p className="form-field__description">{copy.help}</p>

        {readiness === 'missing-tin' ? (
          <Alert tone="warning" density="compact" data-testid="eparagony-seller-missing-tin">
            {copy.missingTin}
          </Alert>
        ) : null}

        {field('eparagonyMerchantTIN', copy.tin.label, {
          description: copy.tin.description,
          inputMode: 'numeric',
        })}

        {field('eparagonyMerchantName', copy.name.label, {
          description: copy.name.description,
          autoComplete: 'organization',
        })}

        <fieldset className="eparagony-seller__address" aria-labelledby={ADDRESS_LEGEND_ID}>
          <legend className="form-field__label" id={ADDRESS_LEGEND_ID}>
            {copy.address.legend}
          </legend>
          <div className="eparagony-seller__address-row eparagony-seller__address-row--street">
            {field('eparagonyMerchantStreet', copy.address.street.label, {
              placeholder: copy.address.street.placeholder,
            })}
            {field('eparagonyMerchantNumber', copy.address.number.label, {
              placeholder: copy.address.number.placeholder,
            })}
            {field('eparagonyMerchantApartment', copy.address.apartment.label)}
          </div>
          <div className="eparagony-seller__address-row eparagony-seller__address-row--city">
            {field('eparagonyMerchantPostalCode', copy.address.postalCode.label, {
              placeholder: copy.address.postalCode.placeholder,
            })}
            {field('eparagonyMerchantCity', copy.address.city.label, {
              placeholder: copy.address.city.placeholder,
            })}
            {field('eparagonyMerchantCountry', copy.address.country.label, {
              placeholder: copy.address.country.placeholder,
            })}
          </div>
          <p className="form-field__description">{copy.address.description}</p>
        </fieldset>

        {readiness !== 'missing-tin' ? (
          <p
            className={`eparagony-seller__readiness eparagony-seller__readiness--${readiness}`}
            data-testid="eparagony-seller-readiness"
          >
            {copy.readiness[readiness === 'complete' ? 'complete' : 'invoicesOnly']}
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
