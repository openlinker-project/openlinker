/**
 * "Test on a recent order" (#2366, spec §5.6a)
 *
 * The arming gate, not garnish: an automation that spends money and cannot be
 * tested before it is armed will not be armed.
 *
 * ## It REPORTS. It never mutates.
 *
 * `POST /automations/evaluate` commits nothing and dispatches nothing, and the
 * mutation behind it invalidates no query key — see its docblock for why the
 * missing `onSuccess` is deliberate.
 *
 * ## Three things it must not get wrong
 *
 * **`wouldFire`, never `matches`.** They differ exactly when the at-most-one
 * gate refused a rule that DID match — the two-money-rules collision. Rendering
 * readiness from `matches` would show green on a rule that will be held back.
 *
 * **The retroactivity waiver is rendered.** A verdict can say "matches" about an
 * order the rule would never actually have acted on, because the dry run waives
 * the floor that the real path enforces. Omitting it makes the preview lie.
 *
 * **A refusal is not an empty result.** A draft re-validates exactly as a save
 * does, so an incomplete rule answers with the save's own 400s. Rendering that
 * as an empty verdict list would claim the rule matches nothing, when the truth
 * is that it was never evaluated.
 *
 * @module apps/web/src/features/automation/components
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormField } from '../../../shared/ui/form-field';
import { KeyValueList } from '../../../shared/ui/key-value-list';
import { Select } from '../../../shared/ui/select';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { shortenId } from '../../../shared/ui/entity-label';
import { useConnectionsQuery } from '../../connections';
import { useOrdersQuery, type OrderRecord } from '../../orders';
import { AUTOMATION_ACTION_LABELS, AUTOMATION_DRY_RUN_COPY } from '../lib/automation.copy';
import { describeAutomationWriteError } from '../lib/automation-write-error';
import { describeAvailability } from '../lib/action-availability';
import {
  conditionOutcomeTone,
  describeConditionOutcome,
  describeNonFiringReason,
  siblingVerdicts,
  subjectVerdict,
  verdictHeadline,
} from '../lib/dry-run-verdict';
import type { AutomationDryRunResult, AutomationVerdict } from '../api/automation.types';

/** Spec §5.6: "pick any order from the last 30 days". */
const DRY_RUN_WINDOW_DAYS = 30;

export interface AutomationDryRunPanelProps {
  /** Runs the evaluation for the chosen order. Returns null when it refused. */
  onRun: (orderId: string) => void;
  isRunning: boolean;
  result: AutomationDryRunResult | null;
  error: unknown;
  /**
   * The draft changed after this result was produced, so it describes the
   * PREVIOUS version. Saying so beats leaving a green verdict on screen under a
   * banner telling the operator to test again.
   */
  isStale?: boolean;
}

/**
 * Label one picker option from `OrderRecord`'s TOP-LEVEL fields only.
 *
 * Deliberately does not reach into `orderSnapshot`: under `OL_STORE_PII=true`
 * that carries the buyer's name, email and address, and a dropdown on a
 * diagnostics panel is not a place to surface them. The shortened internal id
 * plus the date is enough to pick an order, and it is true for every record.
 */
function describeOrderOption(order: OrderRecord): string {
  const placed = order.createdAt.slice(0, 10);
  return `${shortenId(order.internalOrderId)} · ${placed}`;
}

function windowStart(): string {
  const from = new Date();
  from.setDate(from.getDate() - DRY_RUN_WINDOW_DAYS);
  return from.toISOString();
}

function describeHeadline(verdict: AutomationVerdict): {
  label: string;
  tone: 'success' | 'warning' | 'neutral';
} {
  const headline = verdictHeadline(verdict);
  switch (headline) {
    case 'would-fire':
      return { label: AUTOMATION_DRY_RUN_COPY.wouldFire, tone: 'success' };
    case 'would-match-not-fire':
      // Green here would state the opposite of the waiver note below it.
      return { label: AUTOMATION_DRY_RUN_COPY.wouldMatchNotFire, tone: 'warning' };
    case 'would-not-fire':
      return { label: AUTOMATION_DRY_RUN_COPY.wouldNotFire, tone: 'neutral' };
    default: {
      const exhaustive: never = headline;
      throw new Error(`Unhandled verdict headline: ${String(exhaustive)}`);
    }
  }
}

function VerdictBlock({ verdict }: { verdict: AutomationVerdict }): ReactElement {
  const headline = describeHeadline(verdict);
  return (
    <div className="automation-dry-run__verdict">
      <div className="automation-dry-run__verdict-head">
        <StatusBadge tone={headline.tone} withDot compact>
          {headline.label}
        </StatusBadge>
      </div>

      {/*
        The collision. `matches && !wouldFire` is exactly the at-most-one gate
        refusing a rule that did match — and an operator cannot remediate a
        collision they cannot name, so the other rules and the colliding actions
        are both spelled out.
      */}
      {verdict.blockedBy !== null ? (
        <Alert tone="warning">
          <p>{AUTOMATION_DRY_RUN_COPY.matchedButBlocked}</p>
          <p className="muted-text">
            {AUTOMATION_DRY_RUN_COPY.blockedByPrefix}{' '}
            <span className="mono-text">
              {verdict.blockedBy.collidingRuleIds
                .filter((id) => id !== verdict.ruleId)
                .join(', ')}
            </span>{' '}
            {AUTOMATION_DRY_RUN_COPY.blockedActionsPrefix}{' '}
            <span className="mono-text">{verdict.blockedBy.actions.join(', ')}</span>
          </p>
        </Alert>
      ) : null}

      {/* Matches, but the order predates the rule — it would NOT really have run. */}
      {verdict.retroactivityFloorWaived ? (
        <Alert tone="warning">{AUTOMATION_DRY_RUN_COPY.retroactivityWaived}</Alert>
      ) : null}

      {verdict.nonFiringReason === null ? null : (
        <p className="muted-text">{describeNonFiringReason(verdict.nonFiringReason)}</p>
      )}

      <p className="eyebrow">{AUTOMATION_DRY_RUN_COPY.conditionsTitle}</p>
      {verdict.conditionTraces.length === 0 ? (
        <p className="muted-text">{AUTOMATION_DRY_RUN_COPY.noConditions}</p>
      ) : (
        <ul className="automation-dry-run__traces">
          {verdict.conditionTraces.map((trace, index) => (
            <li key={`${trace.field}-${index}`}>
              {/*
                The condition is rendered from its OWN fields, as the backend
                stored it — labelled, never paraphrased.
              */}
              <span className="mono-text">{JSON.stringify(trace.condition)}</span>
              <StatusBadge tone={conditionOutcomeTone(trace.outcome)} compact>
                {describeConditionOutcome(trace.outcome)}
              </StatusBadge>
            </li>
          ))}
        </ul>
      )}

      {verdict.stepAvailability.length === 0 ? null : (
        <>
          <p className="eyebrow">{AUTOMATION_DRY_RUN_COPY.stepsTitle}</p>
          <ul className="automation-dry-run__steps">
            {verdict.stepAvailability.map((step, index) => {
              const described = describeAvailability(step.availability);
              return (
                <li key={`${step.action}-${index}`}>
                  <span>{AUTOMATION_ACTION_LABELS[step.action] ?? step.action}</span>
                  <StatusBadge tone={described.tone} compact>
                    {described.label}
                  </StatusBadge>
                  {/* The backend's own sentence, verbatim. */}
                  {step.reason === null ? null : (
                    <span className="muted-text">{step.reason}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export function AutomationDryRunPanel({
  onRun,
  isRunning,
  result,
  error,
  isStale = false,
}: AutomationDryRunPanelProps): ReactElement {
  const [orderId, setOrderId] = useState('');
  // One batched read for the whole panel — never a per-row connection fetch.
  const connectionsQuery = useConnectionsQuery();
  const connectionNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const connection of connectionsQuery.data ?? []) map.set(connection.id, connection.name);
    return map;
  }, [connectionsQuery.data]);
  const filters = useMemo(() => ({ createdFrom: windowStart() }), []);
  const ordersQuery = useOrdersQuery(filters, { limit: 50, offset: 0 });

  const orders = ordersQuery.data?.items ?? [];
  const subject = result === null ? null : subjectVerdict(result.verdicts);
  const siblings = result === null ? [] : siblingVerdicts(result.verdicts);
  const refusal = error ? describeAutomationWriteError(error) : null;

  return (
    <section className="automation-dry-run">
      <p className="eyebrow">{AUTOMATION_DRY_RUN_COPY.title}</p>
      <p className="muted-text">{AUTOMATION_DRY_RUN_COPY.intro}</p>

      <div className="automation-dry-run__controls">
        <FormField label={AUTOMATION_DRY_RUN_COPY.orderLabel} name="dry-run-order">
          <Select value={orderId} onChange={(event) => setOrderId(event.target.value)}>
            <option value="">{AUTOMATION_DRY_RUN_COPY.orderPlaceholder}</option>
            {orders.map((order) => (
              <option key={order.internalOrderId} value={order.internalOrderId}>
                {describeOrderOption(order)}
              </option>
            ))}
          </Select>
        </FormField>
        <Button
          type="button"
          tone="secondary"
          disabled={isRunning || orderId === ''}
          onClick={() => onRun(orderId)}
        >
          {isRunning ? AUTOMATION_DRY_RUN_COPY.running : AUTOMATION_DRY_RUN_COPY.run}
        </Button>
      </div>

      {ordersQuery.error ? (
        <Alert tone="error">{AUTOMATION_DRY_RUN_COPY.ordersFailed}</Alert>
      ) : null}
      {!ordersQuery.isLoading && !ordersQuery.error && orders.length === 0 ? (
        <p className="muted-text">{AUTOMATION_DRY_RUN_COPY.noOrders}</p>
      ) : null}

      {/*
        A refusal, NOT an empty verdict list. An incomplete draft answers with
        the save's own 400s; showing "no verdicts" here would state that the rule
        matches nothing, when the truth is that it was never evaluated.
      */}
      {refusal === null ? null : (
        <Alert tone="error" title={AUTOMATION_DRY_RUN_COPY.failedTitle}>
          <p>{refusal.message}</p>
          <p className="muted-text">{AUTOMATION_DRY_RUN_COPY.failedHint}</p>
        </Alert>
      )}

      {result !== null && refusal === null && isStale ? (
        <Alert tone="warning">{AUTOMATION_DRY_RUN_COPY.staleResult}</Alert>
      ) : null}

      {result === null || refusal !== null ? null : (
        <div className="automation-dry-run__result">
          {subject === null ? null : <VerdictBlock verdict={subject} />}

          <p className="eyebrow">{AUTOMATION_DRY_RUN_COPY.factsTitle}</p>
          <KeyValueList
            items={[
              {
                id: 'source',
                label: AUTOMATION_DRY_RUN_COPY.factSourceLabel,
                // One of the four condition fields, so omitting it would show a
                // `sourceConnection` trace reading "Not matched" while withholding
                // the fact that explains it.
                value:
                  result.facts.sourceConnectionId === null
                    ? AUTOMATION_DRY_RUN_COPY.factUnknown
                    : (connectionNameById.get(result.facts.sourceConnectionId) ??
                      result.facts.sourceConnectionId),
              },
              {
                id: 'country',
                label: AUTOMATION_DRY_RUN_COPY.factCountryLabel,
                value: result.facts.country ?? AUTOMATION_DRY_RUN_COPY.factUnknown,
              },
              {
                id: 'total',
                label: AUTOMATION_DRY_RUN_COPY.factTotalLabel,
                value:
                  result.facts.totalGross === null
                    ? AUTOMATION_DRY_RUN_COPY.factUnknown
                    : `${result.facts.totalGross} ${result.facts.currency ?? ''}`.trim(),
              },
              {
                id: 'happened',
                label: AUTOMATION_DRY_RUN_COPY.factWhenLabel,
                value: result.facts.occurredAt ?? AUTOMATION_DRY_RUN_COPY.factUnknown,
              },
            ]}
          />

          <p className="eyebrow">{AUTOMATION_DRY_RUN_COPY.otherRulesTitle}</p>
          {siblings.length === 0 ? (
            <p className="muted-text">{AUTOMATION_DRY_RUN_COPY.noOtherRules}</p>
          ) : (
            <ul className="automation-dry-run__siblings">
              {siblings.map((verdict) => (
                <li key={verdict.ruleId}>
                  <span>{verdict.ruleName}</span>
                  <StatusBadge tone={describeHeadline(verdict).tone} compact>
                    {describeHeadline(verdict).label}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
