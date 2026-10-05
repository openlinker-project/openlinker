/**
 * Step 1 — Your product master (#3457)
 *
 * The gate, not a formality: OpenLinker keeps no catalogue or stock of its
 * own, so packing needs at least one connection that shares both. One step,
 * one decision ("this is my product master"); the warehouse behind it is
 * created silently by Confirm and never named here (it shows up later on
 * Fulfilment and Inventory › Locations).
 *
 * States (mockup vocabulary): `step-1-no-product-master`,
 * `step-1-product-master`, `step-1-two-product-masters`,
 * `step-1-stock-syncing`, `step-1-stock-complete`.
 *
 * @module features/oms-onboarding/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import type { Connection } from '../../connections';
import type { InventoryLocation } from '../../inventory';
import type { StockLocatedProgress } from '../hooks/use-stock-located-progress';
import { omsOnboardingCopy as COPY } from '../lib/oms-onboarding.copy';
import { OmsSetupError } from '../lib/oms-setup-error';
import {
  MAX_PRODUCT_MASTERS,
  type PartialProductMaster,
  type ProductMasterCapability,
} from '../lib/product-masters';
import { isOmsRoutingUiEnabled } from '../../../shared/config/oms-routing-ui';
import { ProductMasterCard } from './product-master-card';
import { StepPanel } from './step-panel';

export interface StepProductMasterProps {
  readonly masters: readonly Connection[];
  readonly partial: readonly PartialProductMaster[];
  readonly conflicting: readonly Connection[];
  readonly mainLocation: InventoryLocation | null;
  readonly done: boolean;
  readonly progress: StockLocatedProgress;
  readonly masterNames: string;
  readonly canWrite: boolean;
  readonly demoReadOnly: boolean;
  readonly confirming: boolean;
  readonly confirmError: Error | null;
  readonly onConfirm: () => void;
  readonly onContinue: () => void;
}

const numberFormat = new Intl.NumberFormat('en-US');

function missingLabel(missing: readonly ProductMasterCapability[]): string {
  if (missing.length > 1) return COPY.step1.missingBoth;
  return missing[0] === 'ProductMaster' ? COPY.step1.missingProducts : COPY.step1.missingStock;
}

function describeFailure(error: Error): string {
  if (!(error instanceof OmsSetupError)) return error.message;
  switch (error.step) {
    case 'connection':
      return COPY.step1.failedStep.connection;
    case 'location':
      return COPY.step1.failedStep.location;
    case 'location-inactive':
      return COPY.step1.mainInactiveBody;
    case 'conflict':
      return COPY.step1.conflictBody(error.connectionName ?? '');
    case 'override':
      return COPY.step1.failedStep.override(error.connectionName ?? '');
  }
}

function PartialHints({ partial }: { readonly partial: readonly PartialProductMaster[] }): ReactElement | null {
  if (partial.length === 0) return null;
  return (
    <>
      {partial.map(({ connection, missing }) => (
        <Alert
          key={connection.id}
          tone="info"
          title={COPY.step1.partialTitle}
          data-testid="alert-partial-product-master"
          action={
            <Link className="button button--secondary button--sm" to={`/connections/${connection.id}`}>
              {COPY.step1.openConnection}
            </Link>
          }
        >
          {COPY.step1.partialBody(connection.name, missingLabel(missing))}
        </Alert>
      ))}
    </>
  );
}

export function StepProductMaster(props: StepProductMasterProps): ReactElement {
  const { masters, partial, conflicting, mainLocation, done, progress, masterNames } = props;

  if (masters.length === 0) {
    return (
      <StepPanel
        step={1}
        why={COPY.step1.noMasterWhy}
        next={
          <Link className="button button--primary" to="/connections/new" data-testid="link-connect-product-master">
            {COPY.step1.connectMaster}
          </Link>
        }
      >
        <Alert tone="error" title={COPY.step1.noMasterTitle} data-testid="alert-no-product-master">
          {COPY.step1.noMasterBody}
        </Alert>
        <PartialHints partial={partial} />
      </StepPanel>
    );
  }

  const tooMany = masters.length > MAX_PRODUCT_MASTERS;
  const mainInactive = mainLocation !== null && mainLocation.status !== 'active';
  const cards = masters.map((master) => <ProductMasterCard key={master.id} connection={master} />);

  if (!done) {
    const blocked = tooMany || conflicting.length > 0 || mainInactive;
    const disabled = !props.canWrite || blocked || props.confirming;
    return (
      <StepPanel
        step={1}
        why={COPY.step1.why}
        next={
          <Button
            type="button"
            tone="primary"
            data-testid="btn-confirm-product-master"
            disabled={disabled}
            title={props.demoReadOnly ? DEMO_READ_ONLY_ACTION_MESSAGE : !props.canWrite ? COPY.adminOnly : undefined}
            onClick={props.onConfirm}
          >
            {props.confirming ? COPY.step1.confirming : COPY.step1.confirm}
          </Button>
        }
      >
        {cards}
        {tooMany ? (
          <Alert tone="error" title={COPY.step1.tooManyTitle} data-testid="alert-too-many-product-masters">
            {COPY.step1.tooManyBody(masters.length)}
          </Alert>
        ) : masters.length > 1 ? (
          <Alert tone="warning" title={COPY.step1.twoTitle} data-testid="alert-two-product-masters">
            {COPY.step1.twoBody}
          </Alert>
        ) : null}
        {conflicting.map((master) => (
          <Alert
            key={master.id}
            tone="error"
            title={COPY.step1.conflictTitle}
            data-testid="alert-stock-location-conflict"
            action={
              <Link className="button button--secondary button--sm" to={`/connections/${master.id}/edit`}>
                {COPY.step1.openConnection}
              </Link>
            }
          >
            {COPY.step1.conflictBody(master.name)}
          </Alert>
        ))}
        {mainInactive ? <MainInactiveAlert /> : null}
        <PartialHints partial={partial} />
        {props.confirmError !== null ? (
          <Alert tone="error" title={COPY.step1.failedTitle} data-testid="alert-setup-failed">
            {describeFailure(props.confirmError)} {COPY.step1.failedHint}
          </Alert>
        ) : null}
        {!props.canWrite && !props.demoReadOnly ? <Alert tone="info">{COPY.adminOnly}</Alert> : null}
      </StepPanel>
    );
  }

  const located = numberFormat.format(progress.located);
  const total = numberFormat.format(progress.total);

  return (
    <StepPanel
      step={1}
      why={COPY.step1.why}
      next={
        <Button type="button" tone="primary" data-testid="btn-continue-step-1" onClick={props.onContinue}>
          {COPY.continue}
        </Button>
      }
    >
      {cards}
      <div className="oms-onboarding__progress" aria-live="polite" data-testid="stock-located-progress">
        <div className="oms-onboarding__progress-row">
          <span>{COPY.step1.progressLabel(masterNames)}</span>
          <span className="tabular">{COPY.step1.progressCount(located, total)}</span>
        </div>
        <div
          className="oms-onboarding__progress-track"
          role="progressbar"
          aria-label={COPY.step1.progressAria}
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.located}
        >
          <div
            className="oms-onboarding__progress-fill"
            style={{ width: `${progress.total === 0 ? 0 : Math.round((progress.located / progress.total) * 100)}%` }}
          />
        </div>
      </div>
      {progress.complete ? (
        <Alert tone="success" title={COPY.step1.completeTitle}>
          {COPY.step1.completeBody}
        </Alert>
      ) : (
        <Alert tone="info" title={COPY.step1.syncingTitle(masterNames)}>
          {progress.total === 0 ? COPY.step1.noStockYetBody : COPY.step1.syncingBody(total)}
        </Alert>
      )}
    </StepPanel>
  );
}

function MainInactiveAlert(): ReactElement {
  return (
    <Alert
      tone="error"
      title={COPY.step1.mainInactiveTitle}
      data-testid="alert-main-location-inactive"
      action={
        isOmsRoutingUiEnabled() ? (
          <Link className="button button--secondary button--sm" to="/inventory/locations">
            {COPY.step1.openLocations}
          </Link>
        ) : undefined
      }
    >
      {COPY.step1.mainInactiveBody}
    </Alert>
  );
}
