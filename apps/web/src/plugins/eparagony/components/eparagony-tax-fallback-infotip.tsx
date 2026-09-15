/**
 * eparagony.pl Tax-Fallback Infotip (#3266)
 *
 * Click-to-open explanation of what `config.defaultTaxRateCode` does and why
 * setting it is a hazard.
 *
 * **Click, not hover.** Radix `Tooltip` returns early on
 * `pointerType === 'touch'`, so a hover-only explanation never reaches a phone -
 * the same reason `features/analytics/components/analytics-infotip.tsx` gives
 * for the same choice.
 *
 * Deliberately a LOCAL component rather than an import of that analytics one: a
 * plugin reaching into another feature for a presentational helper is the wrong
 * edge. It reuses the shared `.section-infotip` / `.infotip-*` classes, which
 * are generic (not `analytics-` prefixed) and already live in `index.css`.
 * Promoting a single infotip primitive into `shared/ui` is the obvious follow-up
 * once a third consumer appears.
 *
 * @module plugins/eparagony/components
 */
import type { ReactElement } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/ui/popover';
import {
  EPARAGONY_TAX_FALLBACK_HAZARD_NOTES,
  TAX_FALLBACK_INFOTIP_LABEL,
} from './eparagony-tax-fallback-copy';

export function EparagonyTaxFallbackInfotip(): ReactElement {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="section-infotip" aria-label={TAX_FALLBACK_INFOTIP_LABEL}>
          &#9432;
        </button>
      </PopoverTrigger>
      <PopoverContent className="infotip-popover" align="start" sideOffset={6}>
        {EPARAGONY_TAX_FALLBACK_HAZARD_NOTES.map((note) => (
          <span className="infotip-def" key={note.term}>
            <span className="infotip-def__term">{note.term}</span>
            <span>{note.text}</span>
            {note.caveat ? <span className="infotip-def__caveat">{note.caveat}</span> : null}
          </span>
        ))}
      </PopoverContent>
    </Popover>
  );
}
