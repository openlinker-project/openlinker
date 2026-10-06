/**
 * Steps 5-7: the decisions the OMS takes over after packing (#3457)
 *
 * Sales documents, automations and who decides what are each made on a page of
 * their own, so a step here does not repeat their forms: it says what the
 * decision is, reports where it stands, and takes the operator there. "Not
 * needed" is for an installation that has no use for it (no invoicing, no
 * automations), so it does not stay partially set up for ever.
 *
 * @module features/oms-onboarding/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { omsOnboardingCopy as COPY } from '../lib/oms-onboarding.copy';
import {
  SETUP_REVIEW_ONLY,
  SETUP_STEP_PATHS,
  type SetupStepKey,
  type SetupStepState,
} from '../lib/setup-steps';
import { StepPanel } from './step-panel';

export interface StepSetupPageProps {
  readonly step: number;
  readonly stepKey: SetupStepKey;
  /** `null` while the state is unknown to this viewer (not an admin, or still loading). */
  readonly state: SetupStepState | null;
  readonly last: boolean;
  readonly canWrite: boolean;
  readonly demoReadOnly: boolean;
  readonly saving: boolean;
  readonly onBack: () => void;
  readonly onContinue: () => void;
  readonly onSetSkipped: (skipped: boolean) => void;
}

export function StepSetupPage({
  step,
  stepKey,
  state,
  last,
  canWrite,
  demoReadOnly,
  saving,
  onBack,
  onContinue,
  onSetSkipped,
}: StepSetupPageProps): ReactElement {
  const copy = COPY.setupSteps[stepKey];
  const skipped = state === 'skipped';
  const disabledTitle = demoReadOnly ? DEMO_READ_ONLY_ACTION_MESSAGE : !canWrite ? COPY.adminOnly : undefined;

  return (
    <StepPanel
      step={step}
      why={copy.why}
      onBack={onBack}
      next={
        <Button type="button" tone="primary" data-testid={`btn-continue-step-${String(step)}`} onClick={onContinue}>
          {last ? COPY.setupSteps.finish : COPY.continue}
        </Button>
      }
    >
      <Alert
        tone={state === 'done' ? 'success' : state === 'unknown' ? 'warning' : 'info'}
        title={
          COPY.setupSteps.state[
            state === 'pending' && SETUP_REVIEW_ONLY.includes(stepKey) ? 'none' : (state ?? 'unknown')
          ]
        }
        data-testid={`setup-step-${stepKey}-state`}
      >
        {copy.detail}
      </Alert>
      <div className="oms-onboarding__actions">
        <Link className="button button--secondary" to={SETUP_STEP_PATHS[stepKey]} data-testid={`link-setup-${stepKey}`}>
          {state === 'done' ? COPY.setupSteps.review : copy.open}
        </Link>
        {state !== null && state !== 'done' && !SETUP_REVIEW_ONLY.includes(stepKey) ? (
          <Button
            type="button"
            tone="ghost"
            data-testid={`btn-step-${stepKey}-${skipped ? 'undo' : 'skip'}`}
            disabled={!canWrite || saving}
            title={disabledTitle}
            onClick={() => onSetSkipped(!skipped)}
          >
            {skipped ? COPY.setupSteps.undo : COPY.setupSteps.notNeeded}
          </Button>
        ) : null}
      </div>
    </StepPanel>
  );
}
