/**
 * PromotionTemplateCards (#3935, mockup `promotions-new` step 02)
 *
 * The first step of a new promotion after the benefit type: four cards, one
 * question - when does the customer get the gift? Three templates set the kind
 * of condition and an empty one sets nothing. The details come in the form.
 *
 * @module apps/web/src/features/promotions/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import type { PromotionKind } from '../lib/promotion-form';
import { BenefitTypeCard } from './promotion-benefit-type';

export type PromotionTemplate = PromotionKind | 'empty';

export interface PromotionTemplateCardsProps {
  onChoose: (template: PromotionTemplate) => void;
}

const TEMPLATES: readonly { key: PromotionTemplate; hue: 'a' | 'b' | 'c' | null; glyph: ReactElement }[] = [
  {
    key: 'basket',
    hue: 'a',
    glyph: (
      <svg className="pm-ico" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 8h12l1 12H5L6 8z" />
        <path d="M9 8a3 3 0 0 1 6 0" />
      </svg>
    ),
  },
  {
    key: 'product',
    hue: 'b',
    glyph: (
      <svg className="pm-ico" viewBox="0 0 24 24" aria-hidden="true">
        <ellipse cx="12" cy="7" rx="3" ry="4" />
        <path d="M12 11v10" />
      </svg>
    ),
  },
  {
    key: 'unit',
    hue: 'c',
    glyph: (
      <svg className="pm-ico" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 8h10v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8z" />
        <path d="M15 10h2a2 2 0 0 1 0 4h-2" />
      </svg>
    ),
  },
  {
    key: 'empty',
    hue: null,
    glyph: (
      <svg className="pm-ico" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    ),
  },
];

export function PromotionTemplateCards({ onChoose }: PromotionTemplateCardsProps): ReactElement {
  const copy = useMessages('promotions').new;
  return (
    <div className="pm-stage" data-testid="promotion-templates">
      <div className="pm-vt-hero">
        <BenefitTypeCard step="01" withGhost />
      </div>
      <section className="pm-types" aria-label={copy.templateTitle}>
        <div className="pm-stepbar">
          <span className="pm-card__step">02</span>
          <h2>{copy.templateTitle}</h2>
          <span className="pm-hint pm-hint--plain">{copy.templateHint}</span>
        </div>
        <div className="pm-tpl-grid">
          {TEMPLATES.map((template) => (
            <button
              key={template.key}
              type="button"
              className={['pm-tpl', template.key === 'empty' ? 'pm-tpl--blank' : ''].filter(Boolean).join(' ')}
              data-testid={`promotion-template-${template.key}`}
              onClick={() => {
                onChoose(template.key);
              }}
            >
              <span className={['pm-tpl__ico', template.hue ? `pm-thumb--${template.hue}` : ''].filter(Boolean).join(' ')}>
                {template.glyph}
              </span>
              <span>
                <span className="pm-tpl__t">{copy.template[template.key].title}</span>
                <span className="pm-tpl__d">{copy.template[template.key].example}</span>
              </span>
              <span className="pm-tpl__use">
                {copy.use}
                <span aria-hidden="true">›</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
