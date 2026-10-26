/**
 * The setup steps after packing, read from where each is made (#3457)
 *
 * Document routing, automations and the who-decides page are not OMS state, so
 * nothing here stores whether they are done: each is asked of the place that
 * owns it. Only "not needed" is ours, kept on the OMS connection's config.
 *
 * Admin-only: the automation summary is gated by `enabled` and the hook reports
 * `null` for anyone else, which the page renders as the setup it always showed.
 * The who-decides read is open to read-only roles (#2353) and is not gated.
 *
 * @module features/oms-onboarding/hooks
 */
import { useAutomationSummaryQuery } from '../../automation';
import { useWhoDecidesStatusQuery } from '../../fulfillment-authority';
import type { Connection } from '../../connections';
import { deriveSalesDocumentRows } from '../../sales-documents';
import {
  deriveSetupStepState,
  hasAutomaticDocumentIssuing,
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
  const automations = useAutomationSummaryQuery({ enabled });
  const whoDecides = useWhoDecidesStatusQuery();

  if (!enabled || packingConnection === null) return null;
  // A read still in flight is not an answer: waiting avoids a flash of
  // "partially set up" on a setup that is in fact complete.
  if (automations.isLoading || whoDecides.isLoading) return null;

  const skipped = readSetupSkipped(packingConnection.config);

  // Done only when documents are issued automatically: a manual trigger issues
  // nothing unless someone asks.
  const salesDocumentsDone = hasAutomaticDocumentIssuing(deriveSalesDocumentRows(connections));

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
