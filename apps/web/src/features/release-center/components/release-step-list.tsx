/**
 * Release step list (#4148)
 *
 * The steps of one release, each with its state and the actions the viewer may
 * take. Installation actions are for admins only; everyone else sees them
 * disabled with a reason (the registered exception to hide-write-affordance,
 * ADR-085 decision 8). "Remind me" is the viewer's own row and stays enabled.
 * Required and optional steps differ by a text label, not by colour alone.
 *
 * @module features/release-center/components
 */
import type { ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { useReleaseActions } from '../hooks/use-release-actions';
import { requestReleaseTour } from '../lib/release-center-requests';
import { stepStatusOf, type StepInstance } from '../lib/release-notifications';
import { useReleaseCenterAccess } from '../hooks/use-release-center-access';
import { useReleaseCenterView } from './release-center-provider';

interface StepCopy {
  title: string;
  why: string;
}

export function ReleaseStepList({
  instances,
}: {
  instances: readonly StepInstance[];
}): ReactElement | null {
  const view = useReleaseCenterView();
  const copy = useMessages('release-center');
  const actions = useReleaseActions();
  const { canWriteSteps } = useReleaseCenterAccess();
  if (!view) return null;
  const panel = copy.panel;
  const stepCopies = copy.steps as unknown as Record<string, StepCopy | undefined>;

  return (
    <ol className="release-steps">
      {instances.map((instance) => {
        const { status, doneVia } = stepStatusOf(view.state, instance.itemKey, view.now);
        const text = stepCopies[instance.step.id];
        const closed = status === 'done' || status === 'not_applicable';
        return (
          <li
            key={instance.itemKey}
            className="release-step"
            data-status={status}
            data-importance={instance.importance}
          >
            <div className="release-step__head">
              <p className="release-step__title">{text?.title ?? instance.step.id}</p>
              <StatusBadge compact tone={instance.importance === 'required' ? 'warning' : 'neutral'}>
                {instance.importance === 'required' ? panel.stepRequired : panel.stepOptional}
              </StatusBadge>
            </div>
            {instance.connectionName ? (
              <p className="release-step__for">
                {interpolate(panel.stepFor, { name: instance.connectionName })}
              </p>
            ) : null}
            {text?.why ? <p className="release-step__why">{text.why}</p> : null}
            <div className="release-step__chips">
              {status === 'snoozed' ? (
                <StatusBadge compact tone="info">
                  {panel.snoozedChip}
                </StatusBadge>
              ) : null}
              {status === 'done' ? (
                <StatusBadge compact tone="success" withDot>
                  {doneVia === 'auto' ? panel.doneAuto : panel.doneManual}
                </StatusBadge>
              ) : null}
              {status === 'not_applicable' ? (
                <StatusBadge compact tone="neutral">
                  {panel.naChip}
                </StatusBadge>
              ) : null}
            </div>
            <p className="release-step__hint">
              {canWriteSteps ? panel.stepperAdmin : panel.stepperViewer}
            </p>
            <div className="release-step__actions">
              <Button
                className="button--sm"
               
                tone="ghost"
                onClick={() =>
                  requestReleaseTour({
                    stepId: instance.step.id,
                    connectionId: instance.connectionId,
                  })
                }
              >
                {panel.showMe}
              </Button>
              {closed ? (
                <ReadOnlyLock active={!canWriteSteps} message={panel.needsAdmin}>
                  <Button
                className="button--sm"
                   
                    tone="secondary"
                    disabled={!canWriteSteps}
                    onClick={() => actions.reopenStep(instance.itemKey)}
                  >
                    {panel.undo}
                  </Button>
                </ReadOnlyLock>
              ) : (
                <>
                  <ReadOnlyLock active={!canWriteSteps} message={panel.needsAdmin}>
                    <Button
                className="button--sm"
                     
                      tone="secondary"
                      disabled={!canWriteSteps}
                      onClick={() => actions.markStep(instance.itemKey, 'done')}
                    >
                      {panel.stayAsIs}
                    </Button>
                  </ReadOnlyLock>
                  <ReadOnlyLock active={!canWriteSteps} message={panel.needsAdmin}>
                    <Button
                className="button--sm"
                     
                      tone="secondary"
                      disabled={!canWriteSteps}
                      onClick={() => actions.markStep(instance.itemKey, 'not_applicable')}
                    >
                      {panel.notApplicable}
                    </Button>
                  </ReadOnlyLock>
                  {status === 'open' ? (
                    <Button
                className="button--sm"
                     
                      tone="ghost"
                      onClick={() => actions.snoozeStep(instance.itemKey)}
                    >
                      {panel.remind}
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
