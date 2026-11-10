/**
 * Wizard step names
 *
 * The OMS setup steps' titles and one-line meta, in the operator's language and
 * in wizard order. The order comes from `WIZARD_STEPS`, so a step added there
 * without copy here is a type error rather than a blank stepper entry.
 *
 * @module features/oms-onboarding/hooks
 */
import { useMessages } from '../../../shared/i18n';
import { WIZARD_STEPS, type WizardStepKey } from '../lib/onboarding-state';

export interface WizardStepCopy {
  readonly title: string;
  readonly meta: string;
}

const STEP_ORDER = (Object.keys(WIZARD_STEPS) as WizardStepKey[]).sort(
  (a, b) => WIZARD_STEPS[a] - WIZARD_STEPS[b]
);

export function useWizardSteps(): readonly WizardStepCopy[] {
  const copy = useMessages('oms-onboarding').wizardSteps;
  return STEP_ORDER.map((key) => copy[key]);
}
