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

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import type { Connection } from '../../connections';
import { SalesDocumentsPanel, deriveSalesDocumentRows } from '../../sales-documents';
import { omsOnboardingCopy as COPY } from '../lib/oms-onboarding.copy';
import { SETUP_STEP_NUMBERS } from '../lib/onboarding-state';
import { SETUP_STEP_PATHS } from '../lib/setup-steps';
import { StepPanel } from './step-panel';

export interface StepSalesDocumentsProps {
  readonly connections: readonly Connection[];
  readonly onBack: () => void;
  readonly onContinue: () => void;
}

export function StepSalesDocuments({ connections, onBack, onContinue }: StepSalesDocumentsProps): ReactElement {
  const hasProvider = deriveSalesDocumentRows(connections).length > 0;

  return (
    <StepPanel
      step={SETUP_STEP_NUMBERS.salesDocuments}
      why={COPY.salesDocumentsStep.why}
      onBack={onBack}
      next={
        <Button type="button" tone="primary" data-testid="btn-continue-sales-documents" onClick={onContinue}>
          {COPY.continue}
        </Button>
      }
    >
      {hasProvider ? (
        <SalesDocumentsPanel />
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
      <p className="muted-text">
        {COPY.salesDocumentsStep.perCountry}{' '}
        <Link to={SETUP_STEP_PATHS.salesDocuments}>{COPY.salesDocumentsStep.openRouting}</Link>
      </p>
    </StepPanel>
  );
}
