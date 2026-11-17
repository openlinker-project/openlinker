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
import { useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useReleaseActions } from '../hooks/use-release-actions';
import { requestReleaseTour } from '../lib/release-center-requests';
import { stepStatusOf, type StepInstance } from '../lib/release-notifications';
import { useReleaseCenterAccess } from '../hooks/use-release-center-access';
import { useReleaseCenterView } from './release-center-provider';
import { ReleaseIcon } from './release-icon';

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
    <ol className="release-steps" aria-label={panel.progressLabel}>
      {instances.map((instance, index) => {
        const { status, doneVia } = stepStatusOf(view.state, instance.itemKey, view.now);
        const text = stepCopies[instance.step.id];
        const closed = status === 'done' || status === 'not_applicable';
        const required = instance.importance === 'required';
        return (
          <li
            key={instance.itemKey}
            className="release-step"
            data-status={status}
            data-importance={instance.importance}
          >
            <span className="release-step__ind">
              {closed ? <ReleaseIcon name="check" size={12} /> : index + 1}
            </span>
            <div className="release-step__body">
              <p className="release-step__title">
                {text?.title ?? instance.step.id}
                {instance.connectionName ? (
                  <span className="release-step__conn"> · {instance.connectionName}</span>
                ) : null}
              </p>
              <div className="release-step__chips">
                <span
                  className={`release-chip${required && canWriteSteps ? ' release-chip--accent' : ''}`}
                >
                  {!canWriteSteps
                    ? panel.needsAdmin
                    : required
                      ? panel.stepRequired
                      : panel.stepOptional}
                </span>
                {status === 'snoozed' ? (
                  <span className="release-chip">{panel.snoozedChip}</span>
                ) : null}
                {status === 'done' ? (
                  <span
                    className={`release-chip ${doneVia === 'auto' ? 'release-chip--success' : 'release-chip--info'}`}
                  >
                    {doneVia === 'auto' ? panel.doneAuto : panel.doneManual}
                  </span>
                ) : null}
                {status === 'not_applicable' ? (
                  <span className="release-chip">{panel.naChip}</span>
                ) : null}
              </div>
              {text?.why ? <p className="release-step__why">{text.why}</p> : null}
              {!closed ? (
                <p className="release-step__hint">
                  {canWriteSteps ? panel.stepperAdmin : panel.stepperViewer}
                </p>
              ) : null}
              <div className="release-step__actions">
                {!closed ? (
                  <Button
                    className="button--xs"
                    tone="secondary"
                    onClick={() =>
                      requestReleaseTour({
                        stepId: instance.step.id,
                        connectionId: instance.connectionId,
                      })
                    }
                  >
                    {panel.showMe} <ReleaseIcon name="arrow-right" size={12} />
                  </Button>
                ) : null}
                {closed ? (
                  <ReadOnlyLock active={!canWriteSteps} message={panel.needsAdmin}>
                    <Button
                      className="button--xs"
                      tone="ghost"
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
                        className="button--xs"
                        tone="secondary"
                        disabled={!canWriteSteps}
                        onClick={() => actions.markStep(instance.itemKey, 'done')}
                      >
                        {panel.stayAsIs}
                      </Button>
                    </ReadOnlyLock>
                    <ReadOnlyLock active={!canWriteSteps} message={panel.needsAdmin}>
                      <Button
                        className="button--xs"
                        tone="ghost"
                        disabled={!canWriteSteps}
                        onClick={() => actions.markStep(instance.itemKey, 'not_applicable')}
                      >
                        {panel.notApplicable}
                      </Button>
                    </ReadOnlyLock>
                    {status === 'open' ? (
                      <Button
                        className="button--xs"
                        tone="ghost"
                        onClick={() => actions.snoozeStep(instance.itemKey)}
                      >
                        {panel.remind}
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
