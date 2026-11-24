/**
 * Props every promotion form section shares (#3935)
 *
 * One form, one owner (`PromotionComposer` / the new-promotion page): a section
 * reads the watched values and writes through the same `react-hook-form`
 * instance, and owns no state of its own except what is purely visual.
 *
 * @module apps/web/src/features/promotions/components
 */
import type { UseFormReturn } from 'react-hook-form';
import type { PromotionFormProblem, PromotionFormValues } from '../lib/promotion-form';

export interface PromotionSectionProps {
  form: UseFormReturn<PromotionFormValues>;
  values: PromotionFormValues;
  /** True for a role that cannot write: every control in the section is disabled. */
  readOnly: boolean;
  /** Problems to draw on the fields; empty until the operator tried to save or touched the field. */
  invalid?: ReadonlySet<PromotionFormProblem>;
  /** Entrance order of the card. */
  riseIndex?: number;
  /** The "step" number printed in the card head, when the page numbers its cards. */
  step?: string;
}
