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
import { usePlatforms } from '../../../shared/plugins';
import { Button } from '../../../shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../shared/ui/dropdown-menu';
import {
  ConnectionChip,
  readConnectionEnvironment,
  useConnectionsQuery,
} from '../../connections';
import { resolvePlatformLabel, resolvePlatformShortLabel } from '../../mappings';
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
  onNavigate,
}: {
  instances: readonly StepInstance[];
  /** Called when a step hands the user off to the guided tour, so the panel can step aside. */
  onNavigate?: () => void;
}): ReactElement | null {
  const view = useReleaseCenterView();
  const copy = useMessages('release-center');
  const actions = useReleaseActions();
  const { canWriteSteps } = useReleaseCenterAccess();
  const connections = useConnectionsQuery();
  const platforms = usePlatforms();
  if (!view) return null;
  const connectionById = new Map((connections.data ?? []).map((entry) => [entry.id, entry]));
  const panel = copy.panel;
  const stepCopies = copy.steps as unknown as Record<string, StepCopy | undefined>;

  const anyOpen = instances.some((instance) => {
    const { status } = stepStatusOf(view.state, instance.itemKey, view.now);
    return status !== 'done' && status !== 'not_applicable';
  });

  return (
    <>
    <ol className="release-steps" aria-label={panel.progressLabel}>
      {instances.map((instance, index) => {
        const { status, doneVia } = stepStatusOf(view.state, instance.itemKey, view.now);
        const text = stepCopies[instance.step.id];
        const closed = status === 'done' || status === 'not_applicable';
        const required = instance.importance === 'required';
        // The same step repeated per connection explains itself once, on its first row.
        const explains =
          instances.findIndex((other) => other.step.id === instance.step.id) === index;
        return (
          <li
            key={instance.itemKey}
            className="release-step"
            data-status={status}
            data-importance={instance.importance}
          >
            <span className="release-step__ind">
              {closed ? (
                <svg
                  className="release-step__check"
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M2 6.2l2.6 2.6L10 3.4"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                index + 1
              )}
            </span>
            <div className="release-step__body">
              <p className="release-step__title">{text?.title ?? instance.step.id}</p>
              <div className="release-step__chips">
                {instance.connectionId ? (
                  (() => {
                    const connection = connectionById.get(instance.connectionId);
                    const platformType = connection?.platformType ?? null;
                    return (
                      <ConnectionChip
                        connectionId={instance.connectionId}
                        name={connection?.name ?? instance.connectionName}
                        loading={connections.isLoading}
                        channel={{
                          platformType,
                          label: platformType ? resolvePlatformLabel(platforms, platformType) : null,
                          shortLabel: platformType
                            ? resolvePlatformShortLabel(platforms, platformType)
                            : null,
                          environment: readConnectionEnvironment(connection?.config),
                        }}
                      />
                    );
                  })()
                ) : null}
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
              {text?.why && explains ? <p className="release-step__why">{text.why}</p> : null}
              <div className="release-step__actions">
                {!closed ? (
                  <Button
                    className="button--xs"
                    tone="secondary"
                    onClick={() => {
                      requestReleaseTour({
                        stepId: instance.step.id,
                        connectionId: instance.connectionId,
                      });
                      onNavigate?.();
                    }}
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
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          tone="ghost"
                          className="button--icon button--xs"
                          aria-label={panel.moreActions}
                        >
                          <ReleaseIcon name="dots" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="release-card__menu">
                        {status === 'open' ? (
                          <DropdownMenuItem onSelect={() => actions.snoozeStep(instance.itemKey)}>
                            {panel.remind}
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          disabled={!canWriteSteps}
                          onSelect={() => actions.markStep(instance.itemKey, 'not_applicable')}
                        >
                          {panel.notApplicable}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
    {anyOpen ? (
      <p className="release-steps__note">
        {canWriteSteps ? panel.stepperAdmin : panel.stepperViewer}
      </p>
    ) : null}
    </>
  );
}
