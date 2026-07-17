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
import type { ReactElement } from 'react';

import { codCurrenciesForPlatform } from '../../../shared/shipping/cod-currencies';

interface CodCurrencySupportProps {
  /** Connection `platformType` whose supported COD currencies to list. */
  platformType: string;
}

export function CodCurrencySupport({ platformType }: CodCurrencySupportProps): ReactElement {
  return (
    <div className="form-field">
      <span className="form-field__label">Supported COD currencies</span>
      <p className="form-field__description">
        The carrier collects cash on delivery in these currencies.
      </p>
      <div className="cod-currency-support" role="list" aria-label="Supported COD currencies">
        {codCurrenciesForPlatform(platformType).map((currency) => (
          <span key={currency} className="cod-currency-support__chip" role="listitem">
            {currency}
          </span>
        ))}
      </div>
    </div>
  );
}
