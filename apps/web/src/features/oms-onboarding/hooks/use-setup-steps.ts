/**
 * The setup steps after packing, read from where each is made (#3457)
 *
 * Document routing, automations and the who-decides page are not OMS state, so
 * nothing here stores whether they are done: each is asked of the place that
 * owns it. Only "not needed" is ours, kept on the OMS connection's config.
 *
 * Admin-only by construction: the document-routing read is `@Roles('admin')`,
 * so the queries are not sent for anyone else and the hook reports `null`,
 * which the page renders as the setup it always showed.
 *
 * @module features/oms-onboarding/hooks
 */
import { useAutomationSummaryQuery } from '../../automation';
import { useWhoDecidesStatusQuery } from '../../fulfillment-authority';
import { useSalesDocumentCountriesQuery } from '../../sales-documents';
import type { Connection } from '../../connections';
import { deriveSalesDocumentRows } from '../../sales-documents';
import {
  deriveSetupStepState,
  readSetupSkipped,
  summariseSetup,
  type SetupStepKey,
  type SetupStepState,
  type SetupSummary,
} from '../lib/setup-steps';

export interface SetupStepsView extends SetupSummary {
  readonly states: Readonly<Record<SetupStepKey, SetupStepState>>;
}

export function useSetupSteps(
  enabled: boolean,
  packingConnection: Connection | null,
  connections: readonly Connection[]
): SetupStepsView | null {
  const countries = useSalesDocumentCountriesQuery({ enabled });
  const automations = useAutomationSummaryQuery({ enabled });
  const whoDecides = useWhoDecidesStatusQuery();

  if (!enabled || packingConnection === null) return null;
  // A read still in flight is not an answer: waiting avoids a flash of
  // "partially set up" on a setup that is in fact complete.
  if (countries.isLoading || automations.isLoading || whoDecides.isLoading) return null;

  const skipped = readSetupSkipped(packingConnection.config);

  // Done when a connection is set to issue something (the step's own choice,
  // and enough for documents to be issued on an install with one provider) or
  // when country routing has been set up or acknowledged.
  const roleSet = deriveSalesDocumentRows(connections).some((row) => row.documentKind !== null);
  const salesDocumentsDone = roleSet
    ? true
    : countries.data
      ? countries.data.some(
          (country) =>
            country.ruleCount > 0 ||
            country.invoiceDefaultConnectionId !== null ||
            country.receiptDefaultConnectionId !== null ||
            country.acknowledgedNoDocumentAt !== null
        )
      : null;

  const automationsDone =
    automations.data === undefined || automations.data.envelopeUnreadable
      ? null
      : automations.data.items.some((item) => item.ruleCount > 0);

  const whoDecidesDone = whoDecides.data ? whoDecides.data.attention.counted.length === 0 : null;

  const states: Record<SetupStepKey, SetupStepState> = {
    salesDocuments: deriveSetupStepState(salesDocumentsDone, skipped.includes('salesDocuments')),
    automations: deriveSetupStepState(automationsDone, skipped.includes('automations')),
    whoDecides: deriveSetupStepState(whoDecidesDone, skipped.includes('whoDecides')),
  };
  return { states, ...summariseSetup(states) };
}
