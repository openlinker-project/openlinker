/**
 * PromotionsAttention (#3935, mockup "Do sprawdzenia")
 *
 * "To check" beside the status tabs: how many promotions paused because the gift
 * ran out, and how many because their piece limit is used up. Each is one number
 * that filters the list (a toggle), and both are counted over every promotion,
 * not over what the filters leave.
 *
 * @module apps/web/src/features/promotions/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { AttentionSummary, type AttentionGroup } from '../../../shared/ui/attention-summary';
import type { PromotionAttention } from '../lib/promotion-view';

export interface PromotionsAttentionProps {
  counts: Record<PromotionAttention, number>;
  value: PromotionAttention | null;
  onChange: (next: PromotionAttention | null) => void;
}

export function PromotionsAttention({ counts, value, onChange }: PromotionsAttentionProps): ReactElement {
  const copy = useMessages('promotions').attention;
  const group = (kind: PromotionAttention, label: string, short: string, desc: string): AttentionGroup => ({
    id: kind,
    label,
    short,
    tone: 'warning',
    total: counts[kind],
    items: [
      {
        id: kind,
        label,
        desc,
        tone: 'warning',
        on: value === kind,
        count: counts[kind],
        toggle: (): void => {
          onChange(value === kind ? null : kind);
        },
      },
    ],
  });
  return (
    <AttentionSummary
      label={copy.label}
      groups={[
        group('stock', copy.stockLabel, copy.stockShort, copy.stockDesc),
        group('limit', copy.limitLabel, copy.limitShort, copy.limitDesc),
      ]}
    />
  );
}
