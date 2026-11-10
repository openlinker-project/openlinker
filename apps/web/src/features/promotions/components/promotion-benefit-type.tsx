/**
 * BenefitTypeCard (#3935, mockups "Rodzaj korzyści")
 *
 * The kind of benefit a promotion gives. Only the free gift exists today, so the
 * card is a single selected choice with a note saying so on the detail page; the
 * new-promotion page adds a ghost card announcing more kinds. The row is a list
 * of buttons rather than one fixed card so another kind is one more entry.
 *
 * @module apps/web/src/features/promotions/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { GiftGlyph } from './promotion-thumb';

export interface BenefitTypeCardProps {
  /** The new-promotion page numbers its steps and shows the ghost "more types" card. */
  step?: string;
  withGhost?: boolean;
}

export function BenefitTypeCard({ step, withGhost = false }: BenefitTypeCardProps): ReactElement {
  const copy = useMessages('promotions');
  const label = (
    <>
      {step !== undefined ? <span className="pm-card__step">{step}</span> : null}
      <h2>{copy.benefit.label}</h2>
    </>
  );
  return (
    <section className="pm-types" aria-label={copy.benefit.label} data-testid="promotion-benefit-type">
      {step !== undefined ? (
        <div className="pm-stepbar">
          {label}
          <span className="pm-hint pm-hint--plain">{copy.benefit.only}</span>
        </div>
      ) : (
        <div className="pm-types__head">
          <span className="eyebrow pm-eyebrow--muted">{copy.benefit.label}</span>
          <span className="pm-hint pm-hint--plain">{copy.benefit.only}</span>
        </div>
      )}
      <div className="pm-types__row">
        <button type="button" className="pm-type pm-type--on" aria-pressed="true">
          <span className="pm-type__ico">
            <GiftGlyph />
          </span>
          <span>
            <span className="pm-type__t">{copy.benefit.gift}</span>
            <span className="pm-type__d">{copy.benefit.giftDesc}</span>
          </span>
          <span className="pm-type__mark" aria-hidden="true">
            ✓
          </span>
        </button>
        {withGhost ? (
          <div className="pm-type pm-type--ghost" aria-disabled="true">
            <span className="pm-type__ico">
              <svg className="pm-ico" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <span>
              <span className="pm-type__t">{copy.benefit.more}</span>
              <span className="pm-type__d">{copy.benefit.moreDesc}</span>
            </span>
            <span />
          </div>
        ) : null}
      </div>
    </section>
  );
}
