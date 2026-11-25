/**
 * Catalogue Mode Fieldset (#4281)
 *
 * The control for `config.catalogueMode` (#4280): whether this marketplace
 * connection expects its order lines to resolve to catalog products (`linked`,
 * the historical behaviour) or accepts them as the marketplace's own lines with
 * no product behind them (`none`).
 *
 * Two choice cards (the shared `RadioCardGroup`, so it reads like the other
 * either-or choices in setup) and, below them, whatever the chosen card needs:
 * the master-catalog picker while `linked`, a short statement of what changes
 * while `none`. A connection with no catalog has nothing to pick, so the picker
 * is not rendered then at all rather than hidden.
 *
 * The panel fades in when the operator changes the choice and otherwise stays
 * still, so opening a form (or a wizard preselecting a mode) never animates by
 * itself.
 *
 * Marketplace-neutral by construction: the parent mounts it for every pricing
 * destination (capability-driven, never `platformType`), so Allegro and Erli
 * get the same control from one implementation.
 *
 * @module apps/web/src/features/connections/components
 */
import { useRef, type ReactElement, type ReactNode } from 'react';
import { RadioCardGroup } from '../../../shared/ui/radio-card-group';
import { useMessages } from '../../../shared/i18n';
import type { CatalogueMode } from '../lib/catalogue-mode';

interface CatalogueModeFieldsetProps {
  value: CatalogueMode;
  disabled: boolean;
  onChange: (value: CatalogueMode) => void;
  /** The master-catalog picker (or a hint); rendered only while `linked`. */
  children: ReactNode;
}

export function CatalogueModeFieldset({
  value,
  disabled,
  onChange,
  children,
}: CatalogueModeFieldsetProps): ReactElement {
  const copy = useMessages('connections').editConnectionForm.catalogueMode;

  // The entrance answers the operator's own click and nothing else: the form
  // opening, or a wizard preselecting "No catalog" once it knows the installation
  // has none, changes the value without anyone acting, and must not move.
  const chosenByOperator = useRef(false);
  function handleChange(next: CatalogueMode): void {
    chosenByOperator.current = true;
    onChange(next);
  }

  // The <fieldset>/<legend> pair is the accessible group; the visible title and
  // spacing come from the same `rate-limit-section` block every sibling section
  // on this page uses, so the browser's default fieldset border and legend
  // placement never show. The visible heading is aria-hidden to avoid reading
  // the legend twice.
  return (
    <fieldset className="catalogue-mode-fieldset" disabled={disabled}>
      <legend className="sr-only">{copy.legend}</legend>
      <div className="rate-limit-section">
        <h3 className="rate-limit-section__title" aria-hidden="true">
          {copy.legend}
        </h3>
        <p className="rate-limit-section__help">{copy.help}</p>
        <RadioCardGroup<CatalogueMode>
          name="catalogueMode"
          aria-label={copy.legend}
          value={value}
          disabled={disabled}
          onChange={handleChange}
          options={[
            { value: 'linked', title: copy.linkedTitle, description: copy.linkedBody },
            { value: 'none', title: copy.noneTitle, description: copy.noneHint },
          ]}
        />
        <div
          key={value}
          className={[
            'catalogue-mode__panel',
            chosenByOperator.current ? 'catalogue-mode__panel--enter' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {value === 'none' ? <p className="catalogue-mode__note">{copy.noneBody}</p> : children}
        </div>
      </div>
    </fieldset>
  );
}
