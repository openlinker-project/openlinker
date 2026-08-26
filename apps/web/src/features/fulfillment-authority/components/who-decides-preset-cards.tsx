/**
 * Who-Decides Preset Cards
 *
 * The three arrangements of spec § 3.2 as a single-select radio group, plus the
 * always-visible prospective-only line beneath them.
 *
 * An unavailable arrangement renders DISABLED WITH ITS REASON rather than being
 * hidden — it tells the operator the shape of the choice they will eventually
 * have, the same discipline as #2170's disabled tax-id checkbox.
 *
 * Cards render in the copy module's declared order and are looked up by id in
 * the server's catalogue. An id the server sends that this build does not
 * recognise is not drawn: inventing a card for it would put words in the
 * backend's mouth.
 *
 * @module apps/web/src/features/fulfillment-authority/components
 */
import type { ReactElement } from 'react';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { AuthorityPreset, AuthorityPresetId } from '../api/who-decides.types';
import {
  PRESET_CARD_COPY,
  PRESET_CARD_ORDER,
  PRESET_CURRENT_BADGE,
  PRESET_UNAVAILABLE_BADGE,
  PRESET_UNAVAILABLE_REASON_COPY,
  PRESET_UNAVAILABLE_REASON_FALLBACK,
  WHO_DECIDES_PAGE_COPY,
} from '../lib/who-decides.copy';

export interface WhoDecidesPresetCardsProps {
  presets: readonly AuthorityPreset[];
  /**
   * `null` until the operator picks one — the status payload cannot report
   * which arrangement is in force, so nothing is pre-selected. Typed rather
   * than smuggled in as an empty string cast into the union.
   */
  selected: AuthorityPresetId | null;
  onSelect: (id: AuthorityPresetId) => void;
  /** Read-only sessions still see every card; they just cannot move the choice. */
  disabled: boolean;
}

export function WhoDecidesPresetCards({
  presets,
  selected,
  onSelect,
  disabled,
}: WhoDecidesPresetCardsProps): ReactElement {
  const byId = new Map(presets.map((preset) => [preset.id, preset]));

  return (
    <div className="who-decides-presets">
      <div
        className="who-decides-presets__group"
        role="radiogroup"
        aria-label={WHO_DECIDES_PAGE_COPY.presetsEyebrow}
      >
        {PRESET_CARD_ORDER.map((id) => {
          const preset = byId.get(id);
          if (!preset) {
            return null;
          }
          const copy = PRESET_CARD_COPY[id];
          const isSelected = selected === id;
          const unavailable = !preset.available;
          const reason = preset.unavailableReason
            ? (PRESET_UNAVAILABLE_REASON_COPY[preset.unavailableReason] ??
              PRESET_UNAVAILABLE_REASON_FALLBACK)
            : PRESET_UNAVAILABLE_REASON_FALLBACK;

          return (
            <label
              key={id}
              className={[
                'who-decides-preset',
                isSelected ? 'who-decides-preset--selected' : '',
                unavailable ? 'who-decides-preset--unavailable' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-preset={id}
            >
              <input
                className="who-decides-preset__input"
                type="radio"
                name="who-decides-preset"
                value={id}
                checked={isSelected}
                disabled={unavailable || disabled}
                onChange={() => onSelect(id)}
              />
              <span className="who-decides-preset__body">
                <span className="who-decides-preset__head">
                  <span className="who-decides-preset__title">{copy.title}</span>
                  {unavailable ? (
                    <StatusBadge tone="neutral" compact>
                      {PRESET_UNAVAILABLE_BADGE}
                    </StatusBadge>
                  ) : isSelected ? (
                    <StatusBadge tone="info" compact>
                      {PRESET_CURRENT_BADGE}
                    </StatusBadge>
                  ) : null}
                </span>
                <span className="who-decides-preset__text">{copy.body}</span>
                <span className="who-decides-preset__best">Best if: {copy.bestIf}</span>
                <span className="who-decides-preset__changes">
                  <strong>{copy.changesLabel}</strong> {copy.changes}
                </span>
                {unavailable ? (
                  <span className="who-decides-preset__reason">{reason}</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>

      {/* Always visible, never a tooltip (§ 3.2) — invariant P7 in operator words. */}
      <p className="who-decides-presets__prospective">{WHO_DECIDES_PAGE_COPY.prospectiveOnly}</p>
    </div>
  );
}
