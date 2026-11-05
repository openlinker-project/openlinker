/**
 * GiftRuleTemplateCards (#3940, mockup M31 `promotions/new-template`)
 *
 * The first step of a new promotion: three cards, one question - when does the
 * customer get a gift? The details come in the next step.
 *
 * @module apps/web/src/features/gifts/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { GiftRuleKindValues, type GiftRuleKind } from '../lib/gift-rule-form';

export interface GiftRuleTemplateCardsProps {
  onChoose: (kind: GiftRuleKind) => void;
}

const TEST_ID: Record<GiftRuleKind, string> = {
  product: 'gift-composer-card-product',
  basket: 'gift-composer-card-basket',
  unit: 'gift-composer-card-unit',
};

export function GiftRuleTemplateCards({ onChoose }: GiftRuleTemplateCardsProps): ReactElement {
  const copy = useMessages('gifts');
  return (
    <div data-testid="gift-composer-cards">
      <h3 data-testid="gift-composer-template-title">{copy.template.title}</h3>
      <p className="text-muted">{copy.template.description}</p>
      <div className="gift-template-cards">
        {GiftRuleKindValues.map((kind) => (
          <button
            key={kind}
            type="button"
            className="gift-template-card"
            data-testid={TEST_ID[kind]}
            onClick={() => onChoose(kind)}
          >
            <strong>{copy.template[kind].title}</strong>
            <span className="text-muted">{copy.template[kind].example}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
