/**
 * Release step list (#4148)
 *
 * The steps of one release, each with its state and the actions the viewer may
 * take. Installation actions are for admins only; everyone else sees them
 * disabled with a reason (the registered exception to hide-write-affordance,
 * ADR-086 decision 8).
 * Required and optional steps differ by a text label, not by colour alone.
 *
 * @module features/release-center/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { usePlatforms } from '../../../shared/plugins';
import { Button } from '../../../shared/ui/button';
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

  // Rows of the same step (one per connection) are one step in the list.
  const groups: { instances: StepInstance[] }[] = [];
  for (const instance of instances) {
    const existing = groups.find((group) => group.instances[0].step.id === instance.step.id);
    if (existing) existing.instances.push(instance);
    else groups.push({ instances: [instance] });
  }

  type StatusInfo = {
    status: ReturnType<typeof stepStatusOf>['status'];
    doneVia: ReturnType<typeof stepStatusOf>['doneVia'];
  };

  /** The one badge row of a step: connection, required or optional, and what became of it. */
  const renderChips = (
    instance: StepInstance,
    { status, doneVia }: StatusInfo,
    parts: { connection: boolean; importance: boolean; state: boolean }
  ): ReactElement | null => {
    const required = instance.importance === 'required';
    const connection = instance.connectionId ? connectionById.get(instance.connectionId) : undefined;
    const platformType = connection?.platformType ?? null;
    const chips: ReactElement[] = [];
    // Someone who cannot change settings reads the card note once; a chip per step would only repeat it.
    if (parts.importance && canWriteSteps) {
      chips.push(
        <span
          key="importance"
          className={`release-chip${required && canWriteSteps ? ' release-chip--accent' : ' release-chip--muted'}`}
        >
          {!canWriteSteps ? panel.needsAdmin : required ? panel.stepRequired : panel.stepOptional}
        </span>
      );
    }
    if (parts.connection && instance.connectionId) {
      chips.push(
        <ConnectionChip
          key="connection"
          connectionId={instance.connectionId}
          name={connection?.name ?? instance.connectionName}
          loading={connections.isLoading}
          floatReveal
          channel={{
            platformType,
            label: platformType ? resolvePlatformLabel(platforms, platformType) : null,
            shortLabel: platformType ? resolvePlatformShortLabel(platforms, platformType) : null,
            environment: readConnectionEnvironment(connection?.config),
          }}
        />
      );
    }
    if (parts.state) {
      if (status === 'snoozed') chips.push(<span key="snoozed" className="release-chip">{panel.snoozedChip}</span>);
      if (status === 'done') {
        chips.push(
          <span
            key="done"
            className={`release-chip ${doneVia === 'auto' ? 'release-chip--success' : 'release-chip--info'}`}
          >
            {doneVia === 'auto' ? panel.doneAuto : panel.doneManual}
          </span>
        );
      }
      if (status === 'not_applicable') chips.push(<span key="na" className="release-chip">{panel.naChip}</span>);
    }
    return chips.length > 0 ? <div className="release-step__chips">{chips}</div> : null;
  };

  const renderActions = (instance: StepInstance, { status }: StatusInfo): ReactElement => {
    const closed = status === 'done' || status === 'not_applicable';
    return (
      <div className="release-step__actions">
        {!closed ? (
          <Button
            className="button--xs"
            tone="secondary"
            onClick={() => {
              requestReleaseTour({ stepId: instance.step.id, connectionId: instance.connectionId });
              onNavigate?.();
            }}
          >
            {panel.showMe} <ReleaseIcon name="arrow-right" size={12} />
          </Button>
        ) : null}
        {closed ? (
          <Button
            className="button--xs"
            tone="secondary"
            onClick={() => {
              // A finished step is not in the open list, so it is replayed by name.
              requestReleaseTour({
                replaySteps: [
                  { stepId: instance.step.id, connectionId: instance.connectionId, importance: instance.importance },
                ],
              });
              onNavigate?.();
            }}
          >
            {panel.goBack} <ReleaseIcon name="arrow-right" size={12} />
          </Button>
        ) : null}
        {!canWriteSteps ? null : closed ? (
          <ReadOnlyLock active={!canWriteSteps} message={panel.needsAdmin}>
            <Button
              className="button--xs"
              tone="ghost"
              disabled={!canWriteSteps}
              onClick={() => actions.reopenStep(instance.itemKey)}
            >
              {panel.reopen}
            </Button>
          </ReadOnlyLock>
        ) : (
          <ReadOnlyLock active={!canWriteSteps} message={panel.needsAdmin}>
            <Button
              className="button--xs"
              tone="ghost"
              disabled={!canWriteSteps}
              onClick={() => actions.markStep(instance.itemKey, 'done')}
            >
              {panel.stayAsIs}
            </Button>
          </ReadOnlyLock>
        )}
      </div>
    );
  };

  return (
    <>
    <ol className="release-steps" aria-label={panel.progressLabel}>
      {groups.map((group, index) => {
        const statuses = group.instances.map((instance) => stepStatusOf(view.state, instance.itemKey, view.now));
        const allClosed = statuses.every((entry) => entry.status === 'done' || entry.status === 'not_applicable');
        const first = group.instances[0];
        const text = stepCopies[first.step.id];
        const several = group.instances.length > 1;
        const required = group.instances.some((instance) => instance.importance === 'required');
        return (
          <li
            key={first.step.id}
            className="release-step"
            data-status={allClosed ? 'done' : 'open'}
            data-importance={required ? 'required' : 'optional'}
          >
            <span className="release-step__ind">
              {allClosed ? (
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
              <p className="release-step__title">{text?.title ?? first.step.id}</p>
              {/* Title, then the badges, then the explanation, then what to do: the same order everywhere. */}
              {several ? (
                renderChips(first, statuses[0], { connection: false, importance: true, state: false })
              ) : (
                renderChips(first, statuses[0], { connection: true, importance: true, state: true })
              )}
              {text?.why ? <p className="release-step__why">{text.why}</p> : null}
              {several ? (
                <div className="release-step__targets">
                  {group.instances.map((instance, at) => (
                    <div
                      key={instance.itemKey}
                      className="release-step__target"
                      data-status={statuses[at].status}
                      data-several="true"
                    >
                      {renderChips(instance, statuses[at], { connection: true, importance: false, state: true })}
                      {renderActions(instance, statuses[at])}
                    </div>
                  ))}
                </div>
              ) : (
                renderActions(first, statuses[0])
              )}
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
