/**
 * Analytics infotip
 *
 * Click-to-open definition popover for a KPI card's eyebrow (ⓘ). Wraps the
 * project's Radix-backed `Popover` rather than hand-rolling open/close/escape
 * behaviour — Radix `Tooltip` returns early on `pointerType === 'touch'`, so
 * a hover-only definition never reaches a phone; a click-toggle does.
 *
 * @module features/analytics/components
 */
import type { ReactElement } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/ui/popover';

export interface AnalyticsInfotipDefinition {
  term: string;
  text: string;
  formula?: string;
  caveat?: string;
}

interface AnalyticsInfotipProps {
  ariaLabel: string;
  definitions: AnalyticsInfotipDefinition[];
  align?: 'end' | 'start';
}

export function AnalyticsInfotip({
  align = 'start',
  ariaLabel,
  definitions,
}: AnalyticsInfotipProps): ReactElement {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="section-infotip" aria-label={ariaLabel}>
          &#9432;
        </button>
      </PopoverTrigger>
      <PopoverContent className="infotip-popover" align={align} sideOffset={6}>
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
