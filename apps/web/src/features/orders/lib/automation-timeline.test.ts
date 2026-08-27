/**
 * Automation timeline derivation tests (#2385)
 *
 * S3-8: opening the order must name the rule, the trigger, the timestamp and
 * each step's outcome, so turning the rule off is reachable without already
 * knowing which rule to suspect.
 */
import { describe, expect, it } from 'vitest';
import { buildAutomationTimelineEvents } from './automation-timeline';
import type { AutomationRun } from '../../automation';

const FAILURE = 'The carrier refused the parcel: weight missing.';

function run(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: 'run-1',
    ruleId: 'rule-1',
    ruleName: 'Buy a label when packed',
    trigger: 'order.packed',
    subjectKind: 'order',
    subjectId: 'ol_order_1',
    outcome: 'done',
    steps: [
      { stepIndex: 0, action: 'dispatch-shipment', status: 'done', detail: 'DPD, tracking 0003405', syncJobId: null, unavailableReason: null },
      { stepIndex: 1, action: 'relay-status-to-source', status: 'done', detail: null, syncJobId: null, unavailableReason: null },
    ],
    unreadableStepCount: 0,
    blockedByRuleIds: null,
    firedAt: '2026-08-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('buildAutomationTimelineEvents', () => {
  it('should emit one event per step, in order', () => {
    const events = buildAutomationTimelineEvents([run()]);
    expect(events).toHaveLength(2);
    expect(events[0].title).toBe('Bought the shipping label');
    expect(events[1].title).toBe('Told the marketplace the order shipped');
  });

  it('should name the rule, the trigger and the timestamp on every event', () => {
    // S3-8: all three, or the operator cannot get from the order to the rule.
    const [event] = buildAutomationTimelineEvents([run()]);
    expect(event.by).toBe('Automation · Buy a label when packed');
    expect(event.footer).toBe('Ran because: An order is marked packed');
    expect(event.timestamp).toBe('2026-08-20T10:00:00.000Z');
    expect(event.ruleId).toBe('rule-1');
  });

  it('should render the rule name AS IT FIRED, not a current one', () => {
    // The name is denormalised on the row precisely so a rename — or a deletion —
    // does not make history unreadable.
    const [event] = buildAutomationTimelineEvents([run({ ruleName: 'Old name' })]);
    expect(event.by).toBe('Automation · Old name');
  });

  it('should tone a failed step as an error and carry its reason verbatim', () => {
    const events = buildAutomationTimelineEvents([
      run({
        outcome: 'failed',
        steps: [
          { stepIndex: 0, action: 'dispatch-shipment', status: 'failed', detail: FAILURE, syncJobId: null, unavailableReason: null },
        ],
      }),
    ]);

    expect(events[0].tone).toBe('error');
    expect(events[0].description).toBe(FAILURE);
  });

  it('should additionally emit a "Skipped:" event naming what did not run', () => {
    // A silently missing step is indistinguishable from one that was never
    // configured — which is why the backend records `skipped` at all.
    const events = buildAutomationTimelineEvents([
      run({
        outcome: 'failed',
        steps: [
          { stepIndex: 0, action: 'dispatch-shipment', status: 'failed', detail: FAILURE, syncJobId: null, unavailableReason: null },
          { stepIndex: 1, action: 'relay-status-to-source', status: 'skipped', detail: null, syncJobId: null, unavailableReason: null },
        ],
      }),
    ]);

    expect(events).toHaveLength(2);
    expect(events[1].title).toBe('Skipped: told the marketplace the order shipped');
    expect(events[1].footer).toBe('The automation stopped after the step that failed.');
  });

  it('should write nothing for an order no rule fired on', () => {
    // Firings only. An order matching no rule must not accumulate one line per
    // rule per event, which would drown the timeline this exists to make readable.
    expect(buildAutomationTimelineEvents([])).toEqual([]);
  });

  it('should carry an unavailable step reason rather than leaving it blank', () => {
    const events = buildAutomationTimelineEvents([
      run({
        steps: [
          { stepIndex: 0, action: 'place-hold', status: 'failed', detail: null, syncJobId: null, unavailableReason: 'Order holds are not built yet.' },
        ],
      }),
    ]);
    expect(events[0].description).toBe('Order holds are not built yet.');
  });

  it('should drop a step this build cannot read rather than crash the timeline', () => {
    // `steps` is `readonly unknown[]` on the column — the one open shape here.
    const events = buildAutomationTimelineEvents([
      run({ steps: ['nonsense', { stepIndex: 0, action: 'send-email', status: 'done', detail: null, syncJobId: null, unavailableReason: null }] as never }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Sent an email');
  });

  it('should name the run outcome on exactly ONE event, anchored to stepIndex 0', () => {
    // A run-level fact repeated per step would state N times something true
    // once. The anchor is a property of the DATA — every event of one run
    // shares `firedAt`, so "the first emitted" would be insertion order and
    // fragile against any re-sort.
    const events = buildAutomationTimelineEvents([run({ outcome: 'failed' })]);
    const withOutcome = events.filter((event) => event.runOutcome !== undefined);

    expect(withOutcome).toHaveLength(1);
    expect(withOutcome[0].runOutcome).toBe('failed');
    expect(withOutcome[0].id).toBe('run-1:0');
  });

  it('should carry the outcome even when the first step was skipped', () => {
    const events = buildAutomationTimelineEvents([
      run({
        outcome: 'blocked',
        steps: [
          { stepIndex: 0, action: 'dispatch-shipment', status: 'skipped', detail: null, syncJobId: null, unavailableReason: null },
        ],
      }),
    ]);
    expect(events[0].runOutcome).toBe('blocked');
  });

  it('should use past tense, not the composer’s imperative labels', () => {
    // The composer offers choices; a timeline reports what happened.
    const [event] = buildAutomationTimelineEvents([run()]);
    expect(event.title).not.toBe('Buy the shipping label');
  });
});
