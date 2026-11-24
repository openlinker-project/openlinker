/**
 * Supported COD currencies (read-only carrier info, #1569)
 *
 * Renders the set of cash-on-delivery currencies a carrier accepts as a
 * read-only chip list on its connection setup form. Informational only — the
 * carrier API decides the set, not the operator. Shared by the DPD and InPost
 * setup wizards so the block stays identical across carriers.
 *
 * @module features/connections/components
 */
import { useMessages } from '../../../shared/i18n';
import type { ReactElement } from 'react';

import { codCurrenciesForPlatform } from '../../../shared/shipping/cod-currencies';

interface CodCurrencySupportProps {
  /** Connection `platformType` whose supported COD currencies to list. */
  platformType: string;
}

export function CodCurrencySupport({ platformType }: CodCurrencySupportProps): ReactElement {
  const copy = useMessages('connections').codCurrencySupport;
  return (
    <div className="form-field">
      <span className="form-field__label">{copy.label}</span>
      <p className="form-field__description">
        {copy.description}
      </p>
      <div className="cod-currency-support" role="list" aria-label={copy.label}>
        {codCurrenciesForPlatform(platformType).map((currency) => (
          <span key={currency} className="cod-currency-support__chip" role="listitem">
            {currency}
          </span>
        ))}
      </div>
    </div>
  );
}
