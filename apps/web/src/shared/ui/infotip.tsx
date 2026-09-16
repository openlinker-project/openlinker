/**
 * Infotip
 *
 * Click-to-open definition popover behind an ⓘ mark. Promoted out of
 * `features/analytics` when a second consumer appeared (#3268 review): the
 * eparagony.pl connection form needs the same affordance for the
 * `defaultTaxRateCode` hazard, and the alternative was an element-for-element
 * duplicate whose accessibility fixes would then need making twice.
 *
 * **Click, not hover.** Radix `Tooltip` returns early on
 * `pointerType === 'touch'`, so a hover-only definition never reaches a phone;
 * a click-toggle does.
 *
 * `ariaLabel` names BOTH the trigger and the popover. Radix renders
 * `role="dialog"` on the content, and a dialog with no accessible name is an
 * axe `aria-dialog-name` failure - the panel is reachable but announces as an
 * unnamed dialog. One label for both is correct here because the trigger's
 * label already says what the panel contains.
 *
 * @module shared/ui
 */
import type { ReactElement, ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export interface InfotipDefinition {
  term: string;
  text: ReactNode;
  /** Optional monospaced formula line, rendered under the text. */
  formula?: string;
  caveat?: ReactNode;
}

export interface InfotipProps {
  ariaLabel: string;
  definitions: readonly InfotipDefinition[];
  align?: 'end' | 'start';
}

export function Infotip({ align = 'start', ariaLabel, definitions }: InfotipProps): ReactElement {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="section-infotip" aria-label={ariaLabel}>
          &#9432;
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="infotip-popover"
        align={align}
        sideOffset={6}
        aria-label={ariaLabel}
      >
        {definitions.map((definition) => (
          <span className="infotip-def" key={definition.term}>
            <span className="infotip-def__term">{definition.term}</span>
            <span>{definition.text}</span>
            {definition.formula ? (
              <span className="infotip-def__formula">{definition.formula}</span>
            ) : null}
            {definition.caveat ? (
              <span className="infotip-def__caveat">{definition.caveat}</span>
            ) : null}
          </span>
        ))}
      </PopoverContent>
    </Popover>
  );
}
