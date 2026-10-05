/**
 * Packing status (#3457)
 *
 * What the page shows once packing has been turned on: whether it is on, a
 * short account of the work on Fulfilment, the setup it rests on, and the one
 * control that matters (stop, or start again).
 *
 * The count is "parcels on Fulfilment". The mockup's "N unassigned" is not
 * shown: `GET /fulfillment/works` has no assignee filter, and a count derived
 * from one page of results would be a number the operator cannot trust.
 *
 * States (mockup vocabulary): `status-on`, `status-off`; the stop dialog is
 * `dialog-stop-confirm`. A read-only role sees the banner and the setup list
 * with no stop / start control.
 *
 * @module features/oms-onboarding/components
 */
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import type { PackerSummary } from '../../users';
import { omsOnboardingCopy as COPY } from '../lib/oms-onboarding.copy';
import { AddPackerDialog } from './add-packer-dialog';
import { SetupChecklist, type SetupChecklistRow } from './setup-checklist';

export interface PackingStatusProps {
  readonly live: boolean;
  readonly bannerDetail: string;
  readonly offMasterNames: string;
  readonly masterCount: number;
  readonly masterNames: string;
  readonly firstMasterId: string | null;
  readonly stockDetail: string;
  readonly stockComplete: boolean;
  readonly packerNames: string | null;
  readonly packers: readonly PackerSummary[];
  /** Creating a user is admin-only; the page decides, this only renders it. */
  readonly canAddPackers: boolean;
  readonly canWrite: boolean;
  readonly writeVisible: boolean;
  readonly demoReadOnly: boolean;
  readonly toggling: boolean;
  readonly toggleError: Error | null;
  readonly onAskStop: () => void;
  readonly onStartAgain: () => void;
}

export function PackingStatus(props: PackingStatusProps): ReactElement {
  const [addPackerOpen, setAddPackerOpen] = useState(false);
  const rows: SetupChecklistRow[] = [
    {
      key: 'masters',
      ok: true,
      title: COPY.step4.masters(props.masterCount),
      detail: props.masterNames,
      action:
        props.firstMasterId === null ? null : (
          <Link className="button button--ghost button--sm" to={`/connections/${props.firstMasterId}`}>
            {COPY.status.open}
          </Link>
        ),
    },
    {
      key: 'stock',
      ok: props.stockComplete,
      title: COPY.step4.stock,
      detail: props.stockDetail,
      // The stock sync is background work, so "View" opens its job log: the
      // place to see whether it is running, retrying or failing. Filtered to
      // the first product master's connection (`/jobs-logs` reads the filter
      // from the URL).
      action:
        props.firstMasterId === null ? null : (
          <Link
            className="button button--ghost button--sm"
            to={`/jobs-logs?connectionId=${encodeURIComponent(props.firstMasterId)}`}
          >
            {COPY.step4.view}
          </Link>
        ),
    },
    {
      key: 'packers',
      ok: true,
      title: COPY.step4.packers,
      detail: props.packerNames ?? COPY.step4.noPackers,
      action: props.canAddPackers ? (
        <Button
          type="button"
          tone="ghost"
          className="button--sm"
          data-testid="btn-add-packers"
          onClick={() => setAddPackerOpen(true)}
        >
          {COPY.status.addPackers}
        </Button>
      ) : (
        <Link className="button button--ghost button--sm" to="/users">
          {COPY.status.addPackers}
        </Link>
      ),
    },
  ];

  const disabledTitle = props.demoReadOnly ? DEMO_READ_ONLY_ACTION_MESSAGE : undefined;

  return (
    <div className="oms-onboarding__stack">
      <div
        className={props.live ? 'oms-onboarding__banner' : 'oms-onboarding__banner oms-onboarding__banner--off'}
        data-testid="packing-status-banner"
        data-live={String(props.live)}
      >
        <div>
          <p className="oms-onboarding__banner-title">
            <span className="oms-onboarding__pulse" aria-hidden="true" />
            {props.live ? COPY.status.onTitle : COPY.status.offTitle}
          </p>
          <p className="oms-onboarding__banner-body">
            {props.live ? props.bannerDetail : COPY.status.offBody(props.offMasterNames)}
          </p>
        </div>
        <div className="oms-onboarding__actions">
          {props.live ? (
            <Link className="button button--primary" to="/fulfillment" data-testid="link-open-fulfilment">
              {COPY.status.openFulfilment}
            </Link>
          ) : null}
          {props.writeVisible ? (
            props.live ? (
              <Button
                type="button"
                tone="secondary"
                data-testid="btn-ask-stop"
                disabled={!props.canWrite || props.toggling}
                title={disabledTitle}
                onClick={props.onAskStop}
              >
                {COPY.status.stop}
              </Button>
            ) : (
              <Button
                type="button"
                tone="primary"
                data-testid="btn-turn-on"
                disabled={!props.canWrite || props.toggling}
                title={disabledTitle}
                onClick={props.onStartAgain}
              >
                {props.toggling ? COPY.status.starting : COPY.status.startAgain}
              </Button>
            )
          ) : null}
        </div>
      </div>

      {props.toggleError !== null ? (
        <Alert tone="error" title={COPY.status.toggleFailedTitle}>
          {props.toggleError.message}
        </Alert>
      ) : null}

      <section className="panel oms-onboarding__panel" data-testid="setup-status">
        <h2 className="oms-onboarding__panel-title">{COPY.status.setupTitle}</h2>
        <SetupChecklist rows={rows} testId="setup-status-list" />
      </section>

      {props.canAddPackers ? (
        <AddPackerDialog
          open={addPackerOpen}
          onOpenChange={setAddPackerOpen}
          packers={props.packers}
          demoReadOnly={props.demoReadOnly}
        />
      ) : null}
    </div>
  );
}
