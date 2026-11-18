/**
 * Amazon Marketplace Picker (#4186)
 *
 * Multi-select of the marketplaces an Amazon connection sells on, shared by
 * the setup form and the connection page. A region can have 16 marketplaces,
 * so they are picked from a searchable list instead of a column of
 * checkboxes; the chosen ones show as chips (the first three, then "+N").
 *
 * `extra` carries selected ids outside `marketplaces` (a marketplace this
 * browser does not know, or one of another region) so they stay visible and
 * can be removed rather than vanishing from the selection on save.
 *
 * @module features/amazon/components
 */
import { forwardRef, type ReactElement } from 'react';
import { Combobox, type ComboboxOption } from '../../../shared/ui/combobox';
import type { AmazonMarketplace } from '../lib/amazon-marketplaces';

export interface AmazonMarketplacePickerProps {
  readonly marketplaces: readonly AmazonMarketplace[];
  readonly selected: readonly string[];
  readonly onChange: (ids: string[]) => void;
  /** The label of a marketplace (`Polska (PLN)`), in the active language. */
  readonly labelOf: (marketplace: AmazonMarketplace) => string;
  /** Selected ids `marketplaces` does not hold, with the label to show for each. */
  readonly extra?: readonly { readonly id: string; readonly label: string }[];
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly id?: string;
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: boolean;
  readonly ariaLabel?: string;
}

// More than a region ever has, so the whole list shows before any typing.
const SHOW_ALL_UP_TO = 100;

export const AmazonMarketplacePicker = forwardRef<HTMLButtonElement, AmazonMarketplacePickerProps>(
  function AmazonMarketplacePicker(
    { marketplaces, selected, onChange, labelOf, extra = [], placeholder, disabled, invalid, ariaLabel, ...aria },
    ref,
  ): ReactElement {
    const options: ComboboxOption[] = [
      ...marketplaces.map((marketplace) => ({ id: marketplace.id, label: labelOf(marketplace), hint: marketplace.id })),
      ...extra.map((entry) => ({ id: entry.id, label: entry.label, hint: entry.id })),
    ];
    return (
      <Combobox
        ref={ref}
        mode="multi"
        options={options}
        value={{ kind: 'dictionary', ids: [...selected] }}
        onChange={(next) => onChange(next?.kind === 'dictionary' ? next.ids : [])}
        filterFirstThreshold={SHOW_ALL_UP_TO}
        placeholder={placeholder}
        disabled={disabled}
        invalid={invalid}
        ariaLabel={ariaLabel}
        {...aria}
      />
    );
  },
);
