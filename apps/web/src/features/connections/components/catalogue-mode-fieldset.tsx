/**
 * Catalogue Mode Fieldset (#4281)
 *
 * The edit-page control for `config.catalogueMode` (#4280): whether this
 * marketplace connection expects its order lines to resolve to catalog
 * products (`linked`, the historical behaviour) or accepts them as the
 * marketplace's own lines with no product behind them (`none`).
 *
 * A native `<fieldset>` with two radios, because the edit page uses native
 * controls (checkboxes and `Select`), not `SegmentedControl`. The master-catalog
 * picker is passed in as `children` and shown only while `linked`: a connection
 * with no catalog has nothing to pick, and leaving the picker visible would
 * suggest the choice still matters.
 *
 * Marketplace-neutral by construction: the parent mounts it for every pricing
 * destination (capability-driven, never `platformType`), so Allegro and Erli
 * get the same control from one implementation.
 *
 * @module apps/web/src/features/connections/components
 */
import type { ReactElement, ReactNode } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { useMessages } from '../../../shared/i18n';
import type { CatalogueMode } from '../lib/catalogue-mode';

interface CatalogueModeFieldsetProps {
  value: CatalogueMode;
  disabled: boolean;
  onChange: (value: CatalogueMode) => void;
  /** The master-catalog picker; rendered only while `linked`. */
  children: ReactNode;
}

export function CatalogueModeFieldset({
  value,
  disabled,
  onChange,
  children,
}: CatalogueModeFieldsetProps): ReactElement {
  const copy = useMessages('connections').editConnectionForm.catalogueMode;

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
        <label className="rate-limit-section__toggle">
          <input
            type="radio"
            name="catalogueMode"
            value="linked"
            checked={value === 'linked'}
            onChange={() => onChange('linked')}
          />
          <span>{copy.linked}</span>
        </label>
        <label className="rate-limit-section__toggle">
          <input
            type="radio"
            name="catalogueMode"
            value="none"
            checked={value === 'none'}
            onChange={() => onChange('none')}
          />
          <span>{copy.none}</span>
        </label>
        {value === 'none' ? (
          <Alert tone="info" title={copy.noneTitle}>
            {copy.noneBody}
          </Alert>
        ) : (
          children
        )}
      </div>
    </fieldset>
  );
}
