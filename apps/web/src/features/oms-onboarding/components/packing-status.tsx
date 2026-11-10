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
 * The Shipping row (#3958) is not one of the "steps left": routing and
 * automatic labels are optional, so a setup without them is not partial. It
 * can stop buying labels from here, because that is the one change an
 * operator may need in a hurry; turning it on goes through the step, which
 * asks for the parcel defaults first.
 *
 * @module features/oms-onboarding/components
 */
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import type { PackerSummary } from '../../users';
import type { SetupStepsView } from '../hooks/use-setup-steps';
import {
  SETUP_REVIEW_ONLY,
  SETUP_STEP_PATHS,
  SetupStepKeys,
  describeSetupStep,
  type SetupStepKey,
} from '../lib/setup-steps';
import {
  useShippingStatusCopy,
  useShippingStepCopy,
  type ShippingStatusCopy,
} from '../hooks/use-shipping-setup-copy';
import { omsOnboardingCopy as COPY } from '../lib/oms-onboarding.copy';
import type { ShippingCoverageTotals } from '../lib/shipping-coverage';
import { AddPackerDialog } from './add-packer-dialog';
import { SetupChecklist, type SetupChecklistRow } from './setup-checklist';
import { describeApiError } from '../../../shared/api/describe-api-error';

export interface PackingStatusShipping {
  readonly totals: ShippingCoverageTotals;
  /** `config.autoDispatch.enabled` as saved on the OMS connection. */
  readonly autoDispatchOn: boolean;
  readonly busy: boolean;
  readonly error: Error | null;
  /** Open the Shipping step. */
  readonly onChange: () => void;
  /** Switch buying labels off; resolves once the write landed. */
  readonly onStop: () => Promise<unknown>;
}

function shippingDetail(
  shipping: PackingStatusShipping,
  copy: ShippingStatusCopy,
  checking: string
): string {
  const { totals, autoDispatchOn } = shipping;
  if (!totals.settled) return checking;
  if (totals.unknown && totals.total === 0) return copy.unknown;
  if (autoDispatchOn && totals.withCarrier > 0) return copy.on(totals.withCarrier, totals.total);
  if (totals.withCarrier > 0) return copy.off(totals.withCarrier, totals.total);
  return copy.none;
}

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
  /** The steps after packing; `null` for a role that cannot read them. */
  readonly setup: SetupStepsView | null;
  readonly onContinueSetup: () => void;
  readonly onSetStepSkipped: (step: SetupStepKey, skipped: boolean) => void;
  readonly settingStep: boolean;
  /** Creating a user is admin-only; the page decides, this only renders it. */
  readonly canAddPackers: boolean;
  readonly canWrite: boolean;
  readonly writeVisible: boolean;
  readonly demoReadOnly: boolean;
  readonly toggling: boolean;
  readonly toggleError: Error | null;
  readonly onAskStop: () => void;
  readonly onStartAgain: () => void;
  /** The Shipping row; `null` for a role that cannot read the routing. */
  readonly shipping: PackingStatusShipping | null;
}

export function PackingStatus(props: PackingStatusProps): ReactElement {
  const shippingCopy = useShippingStatusCopy();
  const shippingStepCopy = useShippingStepCopy();
  const [addPackerOpen, setAddPackerOpen] = useState(false);
  const [stopLabelsOpen, setStopLabelsOpen] = useState(false);
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

  const shipping = props.shipping ?? null;
  if (shipping !== null) {
    rows.push({
      key: 'labels',
      ok: shipping.autoDispatchOn || shipping.totals.withCarrier > 0,
      title: shippingCopy.title,
      detail: shippingDetail(shipping, shippingCopy, shippingStepCopy.checking),
      action: (
        <span className="oms-onboarding__actions">
          {shipping.autoDispatchOn ? (
            <>
              <Button
                type="button"
                tone="ghost"
                className="button--sm"
                data-testid="btn-shipping-change"
                onClick={shipping.onChange}
              >
                {shippingCopy.change}
              </Button>
              <Button
                type="button"
                tone="ghost"
                className="button--sm"
                data-testid="btn-shipping-stop"
                disabled={!props.canWrite || shipping.busy}
                title={props.demoReadOnly ? demoReadOnlyActionMessage() : undefined}
                onClick={() => setStopLabelsOpen(true)}
              >
                {shippingCopy.stop}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              tone="ghost"
              className="button--sm"
              data-testid="btn-shipping-start"
              onClick={shipping.onChange}
            >
              {shippingCopy.start}
            </Button>
          )}
        </span>
      ),
    });
  }

  if (props.setup !== null) {
    const setup = props.setup;
    for (const key of SetupStepKeys) {
      const state = setup.states[key];
      const { title, detail } = describeSetupStep(key, state);
      rows.push({
        key,
        ok: state === 'done' || state === 'skipped',
        title,
        detail,
        action: (
          <span className="oms-onboarding__actions">
            <Link className="button button--ghost button--sm" to={SETUP_STEP_PATHS[key]}>
              {state === 'done' ? COPY.status.steps.review : COPY.status.steps.setUp}
            </Link>
            {!SETUP_REVIEW_ONLY.includes(key) && (state === 'pending' || state === 'unknown' || state === 'skipped') ? (
              <Button
                type="button"
                tone="ghost"
                className="button--sm"
                data-testid={`btn-step-${key}-${state === 'skipped' ? 'undo' : 'skip'}`}
                disabled={!props.canWrite || props.settingStep}
                onClick={() => props.onSetStepSkipped(key, state !== 'skipped')}
              >
                {state === 'skipped' ? COPY.status.steps.undo : COPY.status.steps.notNeeded}
              </Button>
            ) : null}
          </span>
        ),
      });
    }
  }

  const disabledTitle = props.demoReadOnly ? demoReadOnlyActionMessage() : undefined;

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
            {props.live
              ? props.setup === null
                ? COPY.status.onTitle
                : props.setup.complete
                  ? COPY.status.setUpTitle
                  : COPY.status.partialTitle
              : COPY.status.offTitle}
          </p>
          <p className="oms-onboarding__banner-body">
            {props.live
              ? props.setup !== null && !props.setup.complete
                ? `${COPY.status.stepsLeft(props.setup.left.length)} ${props.bannerDetail}`
                : props.bannerDetail
              : COPY.status.offBody(props.offMasterNames)}
          </p>
        </div>
        <div className="oms-onboarding__actions">
          {props.live && props.setup !== null && !props.setup.complete ? (
            <Button type="button" tone="secondary" data-testid="btn-continue-setup" onClick={props.onContinueSetup}>
              {COPY.status.continueSetup}
            </Button>
          ) : null}
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
          {describeApiError(props.toggleError)}
        </Alert>
      ) : null}

      <section className="panel oms-onboarding__panel" data-testid="setup-status">
        <h2 className="oms-onboarding__panel-title">{COPY.status.setupTitle}</h2>
        <SetupChecklist rows={rows} testId="setup-status-list" />
      </section>

      {shipping !== null ? (
        <ConfirmDialog
          open={stopLabelsOpen}
          onOpenChange={setStopLabelsOpen}
          title={shippingCopy.stopTitle}
          description={shippingCopy.stopBody}
          body={
            shipping.error === null ? undefined : (
              <Alert tone="error" title={shippingCopy.stopFailedTitle}>
                {shipping.error.message}
              </Alert>
            )
          }
          cancelLabel={shippingCopy.stopCancel}
          confirmLabel={shipping.busy ? shippingCopy.stopping : shippingCopy.stop}
          isConfirming={shipping.busy}
          initialFocus="cancel"
          onConfirm={() => {
            // A failed write keeps the dialog open, with the error in it, so the
            // operator sees the labels are still being bought.
            void shipping.onStop().then(
              () => setStopLabelsOpen(false),
              () => undefined
            );
          }}
        />
      ) : null}

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
