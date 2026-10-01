/**
 * Step 2: Sales documents (#3457)
 *
 * Which document an order gets starts with a connection that can issue one, so
 * the step checks for that first: a connection with `Invoicing` or
 * `Fiscalization` enabled. With none there is nothing to choose, and the step
 * says what to connect.
 *
 * With one or more, the choice is made in the SAME "Connected providers" table
 * as Settings › Sales documents (what each connection issues, which goes first,
 * and when: manual or automatic on an order being paid). It is that page's own
 * panel, not a copy, so a change made here is the change made there and the
 * two cannot disagree.
 *
 * Per-country rules and a default for orders no rule covers stay on the
 * document routing page.
 *
 * @module features/oms-onboarding/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import type { Connection } from '../../connections';
import { SalesDocumentsPanel, deriveSalesDocumentRows } from '../../sales-documents';
import { omsOnboardingCopy as COPY } from '../lib/oms-onboarding.copy';
import { SETUP_STEP_NUMBERS } from '../lib/onboarding-state';
import { SETUP_STEP_PATHS, hasAutomaticDocumentIssuing } from '../lib/setup-steps';
import { StepPanel } from './step-panel';

export interface StepSalesDocumentsProps {
  readonly connections: readonly Connection[];
  /** The operator declared documents not needed (stored on the OMS connection). */
  readonly skipped: boolean;
  readonly canWrite: boolean;
  readonly demoReadOnly: boolean;
  readonly saving: boolean;
  readonly onBack: () => void;
  readonly onContinue: () => void;
  readonly onSetSkipped: (skipped: boolean) => void;
}

export function StepSalesDocuments({
  connections,
  skipped,
  canWrite,
  demoReadOnly,
  saving,
  onBack,
  onContinue,
  onSetSkipped,
}: StepSalesDocumentsProps): ReactElement {
  const rows = deriveSalesDocumentRows(connections);
  const hasProvider = rows.length > 0;
  // Required, not advised: the OMS setup is not done while documents wait for
  // someone to issue them.
  const automatic = hasAutomaticDocumentIssuing(rows);
  // "Not needed" is the way out for a shop with no use for documents, so the
  // requirement cannot dead-end the wizard.
  const canContinue = automatic || skipped;
  const disabledTitle = demoReadOnly ? DEMO_READ_ONLY_ACTION_MESSAGE : !canWrite ? COPY.adminOnly : undefined;

  return (
    <StepPanel
      step={SETUP_STEP_NUMBERS.salesDocuments}
      why={COPY.salesDocumentsStep.why}
      onBack={onBack}
      next={
        <Button
          type="button"
          tone="primary"
          data-testid="btn-continue-sales-documents"
          disabled={!canContinue}
          title={canContinue ? undefined : COPY.salesDocumentsStep.automaticRequiredTitle}
          onClick={onContinue}
        >
          {COPY.continue}
        </Button>
      }
    >
      {hasProvider ? (
        <>
          {canContinue ? null : (
            <Alert
              tone="warning"
              title={COPY.salesDocumentsStep.automaticRequiredTitle}
              data-testid="sales-documents-automatic-required"
            >
              {COPY.salesDocumentsStep.automaticRequiredBody}
            </Alert>
          )}
          <SalesDocumentsPanel />
        </>
      ) : (
        <Alert
          tone="warning"
          title={COPY.salesDocumentsStep.noConnectionTitle}
          data-testid="sales-documents-no-connection"
          action={
            <Link className="button button--secondary button--sm" to="/connections/new">
              {COPY.salesDocumentsStep.addConnection}
            </Link>
          }
        >
          {COPY.salesDocumentsStep.noConnectionBody}
        </Alert>
      )}
      {automatic ? null : (
        <div className="oms-onboarding__actions">
          <Button
            type="button"
            tone="ghost"
            data-testid={`btn-step-salesDocuments-${skipped ? 'undo' : 'skip'}`}
            disabled={!canWrite || saving}
            title={disabledTitle}
            onClick={() => onSetSkipped(!skipped)}
          >
            {skipped ? COPY.setupSteps.undo : COPY.setupSteps.notNeeded}
          </Button>
        </div>
      )}
      <p className="muted-text">
        {COPY.salesDocumentsStep.perCountry}{' '}
        <Link to={SETUP_STEP_PATHS.salesDocuments}>{COPY.salesDocumentsStep.openRouting}</Link>
      </p>
    </StepPanel>
  );
}
