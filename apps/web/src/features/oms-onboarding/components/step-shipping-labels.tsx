/**
 * Step 7: shipping labels (#3572)
 *
 * Unlike the three steps before it, which send the operator to a page of its
 * own, the settings for automatic labels live HERE: they are a handful of
 * fields on the OMS connection, and a page that only held them would be one
 * more place to look. The form is the same one the status page shows under the
 * setup list, rendered embedded so the step keeps the panel and the title.
 *
 * ## It is optional, and it saves on its own
 *
 * "Continue" only moves on. The form has its own Save, because labels are
 * configuration of the OMS connection, not a decision the wizard commits at the
 * end; nothing is bought until packing is turned on (step 8). There is no "Not
 * needed" here: buying labels by hand is a complete setup, so the step is
 * review-only (`SETUP_REVIEW_ONLY`) and never counts as unfinished.
 *
 * ## Needs the packing connection
 *
 * It exists from step 1 ("Confirm the product master" creates it). Reaching this
 * step without one (an unusual deep link) says so, rather than rendering a form
 * that has nowhere to save.
 *
 * @module features/oms-onboarding/components
 */
import type { ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { AutomaticLabelsSection } from '../../auto-dispatch';
import { omsOnboardingCopy as COPY } from '../lib/oms-onboarding.copy';
import { WIZARD_STEPS } from '../lib/onboarding-state';
import type { SetupStepState } from '../lib/setup-steps';
import { StepPanel } from './step-panel';

export interface StepShippingLabelsProps {
  /** The packing connection, or `null` when it does not exist yet. */
  readonly packingConnectionId: string | null;
  /** `null` while the state is unknown to this viewer (not an admin, or still loading). */
  readonly state: SetupStepState | null;
  /** The setup was already live: the button finishes the setup instead of moving on to "Turn it on". */
  readonly last: boolean;
  readonly canWrite: boolean;
  readonly writeVisible: boolean;
  readonly demoReadOnly: boolean;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}

export function StepShippingLabels(props: StepShippingLabelsProps): ReactElement {
  const copy = COPY.setupSteps.shippingLabels;
  // Review-only: "not set up yet" reads as "none yet", never as something missing.
  const stateKey = props.state === 'pending' ? 'none' : (props.state ?? 'unknown');

  return (
    <StepPanel
      step={WIZARD_STEPS.shippingLabels}
      why={copy.why}
      onBack={props.onBack}
      next={
        <Button
          type="button"
          tone="primary"
          data-testid={`btn-continue-step-${String(WIZARD_STEPS.shippingLabels)}`}
          onClick={props.onContinue}
        >
          {props.last ? COPY.setupSteps.finish : COPY.continue}
        </Button>
      }
    >
      <Alert
        tone={props.state === 'done' ? 'success' : props.state === 'unknown' ? 'warning' : 'info'}
        title={COPY.setupSteps.state[stateKey]}
        data-testid="setup-step-shippingLabels-state"
      >
        {copy.detail}
      </Alert>

      {props.packingConnectionId === null ? (
        <Alert tone="warning" title={COPY.setupSteps.shippingLabelsNoConnectionTitle}>
          {COPY.setupSteps.shippingLabelsNoConnectionBody}
        </Alert>
      ) : (
        <AutomaticLabelsSection
          embedded
          connectionId={props.packingConnectionId}
          canWrite={props.canWrite}
          writeVisible={props.writeVisible}
          demoReadOnly={props.demoReadOnly}
        />
      )}
    </StepPanel>
  );
}
