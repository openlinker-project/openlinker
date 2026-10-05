/**
 * Step 4 — Turn it on (#3457)
 *
 * One write: the packing connection's sourcing claim, switched on. Two
 * refusals are handled rather than thrown past the step:
 *
 * - **Another connection already decides where orders are packed.** Turning
 *   ours on would leave two claimants, the server's row would read ambiguous
 *   and nothing would decide at all — so the button is disabled and the
 *   operator is sent to Who decides what (the server's answer, read from the
 *   `sourcing` row, never re-derived here).
 * - **No active warehouse** (#2407). Step 1 creates one, so this is reachable
 *   only if it was retired since; mapped by code, never by message.
 *
 * State (mockup vocabulary): `step-4-turn-on`.
 *
 * @module features/oms-onboarding/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { omsOnboardingCopy as COPY } from '../lib/oms-onboarding.copy';
import { isRoutingRequiresLocationError } from '../lib/routing-requires-location-error';
import { SetupChecklist, type SetupChecklistRow } from './setup-checklist';
import { StepPanel } from './step-panel';

export interface StepTurnOnProps {
  readonly masterCount: number;
  readonly masterNames: string;
  readonly stockDetail: string;
  readonly stockComplete: boolean;
  readonly packerNames: string | null;
  readonly otherSystemDecides: boolean;
  readonly canWrite: boolean;
  readonly demoReadOnly: boolean;
  readonly turningOn: boolean;
  readonly turnOnError: Error | null;
  readonly onGoToStep: (step: number) => void;
  readonly onTurnOn: () => void;
}

function RowLink({ testId, label, onClick }: { testId: string; label: string; onClick: () => void }): ReactElement {
  return (
    <Button type="button" tone="ghost" className="button--sm" data-testid={testId} onClick={onClick}>
      {label}
    </Button>
  );
}

export function StepTurnOn(props: StepTurnOnProps): ReactElement {
  const rows: SetupChecklistRow[] = [
    {
      key: 'masters',
      ok: true,
      title: COPY.step4.masters(props.masterCount),
      detail: props.masterNames,
      action: <RowLink testId="btn-go-step-1" label={COPY.step4.view} onClick={() => props.onGoToStep(1)} />,
    },
    {
      key: 'stock',
      ok: props.stockComplete,
      title: COPY.step4.stock,
      detail: props.stockComplete ? props.stockDetail : `${props.stockDetail} · ${COPY.step4.stillFilling}`,
      action: <RowLink testId="btn-go-step-1-stock" label={COPY.step4.view} onClick={() => props.onGoToStep(1)} />,
    },
    {
      key: 'packers',
      ok: true,
      title: COPY.step4.packers,
      detail: props.packerNames ?? COPY.step4.noPackers,
      action: <RowLink testId="btn-go-step-2" label={COPY.step4.change} onClick={() => props.onGoToStep(2)} />,
    },
  ];

  const noLocation = props.turnOnError !== null && isRoutingRequiresLocationError(props.turnOnError);

  return (
    <StepPanel
      step={4}
      why={COPY.step4.why}
      onBack={() => props.onGoToStep(3)}
      next={
        <Button
          type="button"
          tone="primary"
          data-testid="btn-turn-on"
          disabled={!props.canWrite || props.otherSystemDecides || props.turningOn}
          title={props.demoReadOnly ? DEMO_READ_ONLY_ACTION_MESSAGE : !props.canWrite ? COPY.adminOnly : undefined}
          onClick={props.onTurnOn}
        >
          {props.turningOn ? COPY.step4.turningOn : COPY.step4.turnOn}
        </Button>
      }
    >
      <SetupChecklist rows={rows} testId="setup-summary" />
      {props.otherSystemDecides ? (
        <Alert
          tone="error"
          title={COPY.step4.otherSystemTitle}
          data-testid="alert-other-system-decides"
          action={
            <Link className="button button--secondary button--sm" to="/settings/who-decides">
              {COPY.step4.whoDecidesLink}
            </Link>
          }
        >
          {COPY.step4.otherSystemBody}
        </Alert>
      ) : null}
      {noLocation ? (
        <Alert tone="error" title={COPY.step4.noLocationTitle} data-testid="alert-turn-on-no-location">
          {COPY.step4.noLocationBody}
        </Alert>
      ) : props.turnOnError !== null ? (
        <Alert tone="error" title={COPY.step4.failedTitle}>
          {props.turnOnError.message}
        </Alert>
      ) : null}
      {!props.canWrite && !props.demoReadOnly ? <Alert tone="info">{COPY.adminOnly}</Alert> : null}
    </StepPanel>
  );
}
