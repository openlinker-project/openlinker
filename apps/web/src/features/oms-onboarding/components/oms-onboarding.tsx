/**
 * Pack orders in OpenLinker — the onboarding wizard and its status page (#3457)
 *
 * Four steps (product master, packers, what changes, turn on), then a status
 * page. Implements the `data-state` / `data-source` vocabulary and the
 * `data-testid` values of `docs/plans/mockups/oms-onboarding-wizard.html`.
 *
 * ## The page resolves the platform; this feature never compares one (D19)
 *
 * The packing connection is identified by its `platformType`, and that
 * comparison lives in the PAGE (the #3060 sourcing-rules precedent). This
 * feature receives the resolved `packingConnection` and the literal it must
 * create one with, and chooses product masters by capability alone.
 * `__tests__/no-platform-type.test.ts` fails the build on a comparison here.
 *
 * ## Position is derived, not remembered
 *
 * Where the operator is comes from the server on every load: step 1 is done
 * when all its writes are in place, packing is on when the server's own
 * `sourcing` row says so. Nothing is kept in local storage. The loader waits
 * for those facts before mounting the flow, so the initial position is
 * computed once from settled data rather than jumping as queries resolve.
 *
 * `data-state` / `data-source` sit on this component's root rather than on
 * `<body>` as in the mockup; the E2E spec (#3458) reads the wizard root.
 *
 * @module features/oms-onboarding/components
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { useIsAdmin, useWriteAccess } from '../../../shared/auth/use-permission';
import { formatRelativeTime } from '../../../shared/format/format-relative-time';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { PageLayout } from '../../../shared/ui/page-layout';
import { SetupStepper } from '../../../shared/ui/setup-stepper';
import { WizardLayout } from '../../../shared/ui/wizard-layout';
import { Button } from '../../../shared/ui/button';
import type { Connection } from '../../connections';
import { useWhoDecidesStatusQuery } from '../../fulfillment-authority';
import type { InventoryLocation } from '../../inventory';
import { useDemoMode } from '../../system';
import { usePackersQuery, type PackerSummary } from '../../users';
import { useConfirmProductMasterMutation } from '../hooks/use-confirm-product-master-mutation';
import { useFulfillmentSnapshotQuery } from '../hooks/use-fulfillment-snapshot-query';
import { useMainLocationQuery } from '../hooks/use-main-location-query';
import { useSetPackingMutation } from '../hooks/use-set-packing-mutation';
import { useStockLocatedProgress } from '../hooks/use-stock-located-progress';
import { omsOnboardingCopy as COPY } from '../lib/oms-onboarding.copy';
import { FIRST_ORDER_POLL_MS, STATUS_POLL_MS } from '../lib/oms-onboarding.constants';
import {
  deriveDataState,
  findConflictingMasters,
  initialPosition,
  isPackingLive,
  isPackingPaused,
  isStep1Done,
  readSourcingStanding,
  resolveDataSource,
  TOTAL_STEPS,
  type OnboardingView,
  type SourcingStanding,
} from '../lib/onboarding-state';
import { selectProductMasters } from '../lib/product-masters';
import { FirstOrderPanel } from './first-order-panel';
import { NextStepsNotice } from './next-steps-notice';
import { PackingStatus } from './packing-status';
import { StepPackers } from './step-packers';
import { StepProductMaster } from './step-product-master';
import { StepTurnOn } from './step-turn-on';
import { StepWhatChanges } from './step-what-changes';
import { StopPackingDialog } from './stop-packing-dialog';

export interface OmsOnboardingProps {
  /** Every connection, as the page read them. */
  readonly connections: readonly Connection[];
  /** The OpenLinker packing connection, resolved by the page, or `null`. */
  readonly packingConnection: Connection | null;
  /** The platform literal to create the packing connection with. Never compared here. */
  readonly omsPlatformType: string;
}

const numberFormat = new Intl.NumberFormat('en-US');

function joinNames(masters: readonly Connection[]): string {
  return masters.map((master) => master.name).join(COPY.and);
}

function Shell({ inWizard, children }: { inWizard: boolean; children: ReactElement }): ReactElement {
  return (
    <PageLayout
      eyebrow={COPY.page.eyebrow}
      title={inWizard ? COPY.page.wizardTitle : COPY.page.statusTitle}
      description={inWizard ? COPY.page.wizardDescription : COPY.page.statusDescription}
      backTo={{ to: '/settings', label: COPY.page.backToSettings }}
    >
      {children}
    </PageLayout>
  );
}

export function OmsOnboarding(props: OmsOnboardingProps): ReactElement {
  const mainLocationQuery = useMainLocationQuery();
  const whoDecidesQuery = useWhoDecidesStatusQuery();
  const packersQuery = usePackersQuery();

  if (mainLocationQuery.isLoading || whoDecidesQuery.isLoading) {
    return (
      <Shell inWizard>
        <LoadingState title={COPY.page.loadingTitle} message={COPY.page.loadingMessage} />
      </Shell>
    );
  }

  if (mainLocationQuery.error) {
    return (
      <Shell inWizard>
        <ErrorState
          title={COPY.page.errorTitle}
          message={COPY.page.errorMessage}
          action={
            <Button tone="secondary" onClick={() => void mainLocationQuery.refetch()}>
              {COPY.page.retry}
            </Button>
          }
        />
      </Shell>
    );
  }

  const packingId = props.packingConnection?.id ?? null;
  // The who-decides read degrading (error or unreadable payload) is not a
  // reason to refuse the page: the standing falls back to `unknown`, and the
  // live answer to the config's own claim.
  const sourcingRow = whoDecidesQuery.data?.rows.find((row) => row.question === 'sourcing');

  return (
    <OnboardingFlow
      {...props}
      mainLocation={mainLocationQuery.data ?? null}
      standing={readSourcingStanding(sourcingRow, packingId)}
      // A role that cannot read the roster (it is admin + operator) simply
      // sees no packers; the step still works for the admin who can add them.
      packers={packersQuery.data?.packers ?? []}
    />
  );
}

interface OnboardingFlowProps extends OmsOnboardingProps {
  readonly mainLocation: InventoryLocation | null;
  readonly standing: SourcingStanding;
  readonly packers: readonly PackerSummary[];
}

function OnboardingFlow(props: OnboardingFlowProps): ReactElement {
  const { packingConnection, mainLocation, standing, packers } = props;

  const { eligible: masters, partial } = useMemo(
    () =>
      selectProductMasters(
        props.connections.filter((connection) => connection.id !== packingConnection?.id)
      ),
    [props.connections, packingConnection?.id]
  );

  const step1Done = isStep1Done({ masters, packingConnection, mainLocation });
  const live = isPackingLive(standing, packingConnection);
  const paused = isPackingPaused(packingConnection, live);
  const conflicting = findConflictingMasters(masters, mainLocation);

  const [position] = useState(() => initialPosition(live, paused, step1Done));
  const [view, setView] = useState<OnboardingView>(position.view);
  const [step, setStep] = useState(position.step);
  const [maxReached, setMaxReached] = useState(position.step);
  const [completed, setCompleted] = useState<ReadonlySet<number>>(() => new Set());
  const [acknowledged, setAcknowledged] = useState(false);
  const [turnedOnAt, setTurnedOnAt] = useState<string | null>(null);
  const [stopOpen, setStopOpen] = useState(false);

  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  const isAdmin = useIsAdmin();
  // Paired with the role: `POST /users` and the location bootstrap are
  // `@Roles('admin')` while `connections:write` is also an operator's.
  const canWrite = write.canWrite && isAdmin;

  const confirm = useConfirmProductMasterMutation();
  const setPacking = useSetPackingMutation();
  const progress = useStockLocatedProgress(step1Done && mainLocation !== null ? mainLocation.id : null);

  const snapshotQuery = useFulfillmentSnapshotQuery({
    enabled: view !== 'wizard',
    refetchIntervalMs: view === 'waiting' ? FIRST_ORDER_POLL_MS : view === 'status' ? STATUS_POLL_MS : false,
  });
  const snapshot = snapshotQuery.data ?? { total: 0, newest: null };

  const arrivedTask =
    turnedOnAt !== null && snapshot.newest !== null && snapshot.newest.createdAt >= turnedOnAt
      ? snapshot.newest
      : null;

  useEffect(() => {
    if (view === 'waiting' && arrivedTask !== null) setView('first');
  }, [view, arrivedTask]);

  const masterNames = joinNames(masters);
  const offMasterNames = masters.length > 1 ? COPY.yourProductMasters : masterNames;
  const packerNames = packers.length > 0 ? packers.map((packer) => packer.username).join(', ') : null;
  const stockDetail = COPY.step1.progressCount(
    numberFormat.format(progress.located),
    numberFormat.format(progress.total)
  );

  const goToStep = (next: number): void => {
    setStep(next);
    setMaxReached((reached) => Math.max(reached, next));
    setView('wizard');
  };

  const completeStep = (done: number): void => {
    setCompleted((previous) => new Set(previous).add(done - 1));
    goToStep(Math.min(TOTAL_STEPS, done + 1));
  };

  const turnOn = (nextView: OnboardingView): void => {
    if (packingConnection === null) return;
    setPacking.reset();
    setPacking.mutate(
      { packingConnectionId: packingConnection.id, enabled: true },
      {
        onSuccess: () => {
          setTurnedOnAt(new Date().toISOString());
          setCompleted((previous) => new Set(previous).add(TOTAL_STEPS - 1));
          setView(nextView);
        },
      }
    );
  };

  const stop = (): void => {
    if (packingConnection === null) return;
    setPacking.reset();
    setPacking.mutate(
      { packingConnectionId: packingConnection.id, enabled: false },
      {
        onSuccess: () => {
          setStopOpen(false);
          setTurnedOnAt(null);
          setView('status');
        },
      }
    );
  };

  const dataState = deriveDataState({
    view,
    // The status page reads the SERVER's answer; right after a successful
    // toggle it is refetching, so the mutation's own outcome stands in.
    live: setPacking.isSuccess ? setPacking.variables.enabled : live,
    step,
    masterCount: masters.length,
    step1Done,
    stockComplete: progress.complete,
    packerCount: packers.length,
  });
  const liveNow = dataState === 'status-on' || view === 'waiting' || view === 'first';

  const inWizard = view === 'wizard';
  const completedSteps = new Set(completed);
  if (step1Done) completedSteps.add(0);

  const body = inWizard ? (
    <WizardLayout
      stepper={
        <SetupStepper
          steps={COPY.steps.map((s) => s.title)}
          currentStep={step - 1}
          completedSteps={completedSteps}
          maxReachedStep={maxReached - 1}
          onSelectStep={(index) => goToStep(index + 1)}
          testId="wizard-stepper"
        />
      }
    >
      {step === 1 ? (
        <StepProductMaster
          masters={masters}
          partial={partial}
          conflicting={conflicting}
          mainLocation={mainLocation}
          done={step1Done}
          progress={progress}
          masterNames={masterNames}
          canWrite={canWrite}
          demoReadOnly={write.demoReadOnly}
          confirming={confirm.isPending}
          confirmError={confirm.error}
          onConfirm={() => {
            confirm.reset();
            confirm.mutate({
              packingConnection,
              omsPlatformType: props.omsPlatformType,
              masters,
            });
          }}
          onContinue={() => completeStep(1)}
        />
      ) : step === 2 ? (
        <StepPackers
          packers={packers}
          canWrite={canWrite}
          demoReadOnly={write.demoReadOnly}
          onBack={() => goToStep(1)}
          onContinue={() => completeStep(2)}
        />
      ) : step === 3 ? (
        <StepWhatChanges
          masterCount={masters.length}
          masterNames={masterNames}
          acknowledged={acknowledged}
          onAcknowledge={setAcknowledged}
          onBack={() => goToStep(2)}
          onContinue={() => completeStep(3)}
        />
      ) : (
        <StepTurnOn
          masterCount={masters.length}
          masterNames={masterNames}
          stockDetail={stockDetail}
          stockComplete={progress.complete}
          packerNames={packerNames}
          otherSystemDecides={standing === 'other'}
          canWrite={canWrite && step1Done && packingConnection !== null}
          demoReadOnly={write.demoReadOnly}
          turningOn={setPacking.isPending}
          turnOnError={setPacking.error}
          onGoToStep={goToStep}
          onTurnOn={() => turnOn('waiting')}
        />
      )}
    </WizardLayout>
  ) : view === 'waiting' || view === 'first' ? (
    <div className="oms-onboarding__stack">
      <div className="oms-onboarding__banner" data-testid="packing-status-banner" data-live="true">
        <div>
          <p className="oms-onboarding__banner-title">
            <span className="oms-onboarding__pulse" aria-hidden="true" />
            {COPY.status.onTitle}
          </p>
          <p className="oms-onboarding__banner-body">{COPY.status.onBodyWaiting}</p>
        </div>
        <Link className="button button--primary" to="/fulfillment" data-testid="link-open-fulfilment">
          {COPY.status.openFulfilment}
        </Link>
      </div>
      <FirstOrderPanel
        arrivedTask={view === 'first' ? arrivedTask ?? snapshot.newest : null}
        masterNames={masterNames}
        onGoToStatus={() => setView('status')}
      />
      <NextStepsNotice />
    </div>
  ) : (
    <>
      <PackingStatus
        live={liveNow}
        bannerDetail={COPY.status.onBody(
          snapshot.total,
          snapshot.newest === null ? null : formatRelativeTime(snapshot.newest.createdAt)
        )}
        offMasterNames={offMasterNames}
        masterCount={masters.length}
        masterNames={masterNames}
        firstMasterId={masters[0]?.id ?? null}
        stockDetail={COPY.status.stockFrom(
          numberFormat.format(progress.located),
          numberFormat.format(progress.total),
          masterNames
        )}
        stockComplete={progress.complete}
        packerNames={packerNames}
        packers={packers}
        canAddPackers={canWrite}
        canWrite={canWrite && packingConnection !== null}
        writeVisible={write.visible}
        demoReadOnly={write.demoReadOnly}
        toggling={setPacking.isPending}
        toggleError={stopOpen ? null : setPacking.error}
        onAskStop={() => {
          setPacking.reset();
          setStopOpen(true);
        }}
        onStartAgain={() => turnOn('status')}
      />
      {liveNow ? <NextStepsNotice /> : null}
      <StopPackingDialog
        open={stopOpen}
        masterNames={offMasterNames}
        parcelsOnFulfilment={snapshot.total}
        stopping={setPacking.isPending}
        onOpenChange={setStopOpen}
        onConfirm={stop}
      />
    </>
  );

  return (
    <Shell inWizard={inWizard}>
      <div
        className="oms-onboarding"
        data-testid="oms-onboarding"
        data-state={dataState}
        data-source={resolveDataSource(masters)}
      >
        {body}
      </div>
    </Shell>
  );
}
