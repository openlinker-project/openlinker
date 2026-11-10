/**
 * Props every gift promotion form section shares (#3935)
 *
 * One form, one owner (`GiftRuleComposer`): a section reads the watched values
 * and writes through the same `react-hook-form` instance, and owns no state of
 * its own except what is purely visual.
 *
 * @module apps/web/src/features/gifts/components
 */
import type { UseFormReturn } from 'react-hook-form';
import type { GiftRuleFormValues } from '../lib/gift-rule-form';

export interface GiftRuleSectionProps {
  form: UseFormReturn<GiftRuleFormValues>;
  values: GiftRuleFormValues;
  /** True for a role that cannot write: every control in the section is disabled. */
  readOnly: boolean;
}
