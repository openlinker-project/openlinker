import { describe, expect, it } from 'vitest';
import {
  automationFailureTitle,
  buildAutomationFailureView,
  retryRefusalCopy,
  stepReasonText,
} from './automation-failure';
import { AUTOMATION_ACTION_VALUES } from '../api/automation.types';
import type { AutomationRun, AutomationStepResult } from '../api/automation.types';

function step(overrides: Partial<AutomationStepResult> = {}): AutomationStepResult {
  return {
    stepIndex: 0,
    action: 'dispatch-shipment',
    status: 'failed',
    detail: null,
    report: null,
    syncJobId: null,
    unavailableReason: null,
    ...overrides,
  };
}

function run(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: 'run-1',
    ruleId: 'rule-1',
    ruleName: 'Ship paid orders',
    trigger: 'order.packed',
    subjectKind: 'order',
    subjectId: 'ol_order_1',
    outcome: 'failed',
    steps: [],
    unreadableStepCount: 0,
    blockedByRuleIds: null,
    firedAt: '2026-08-20T10:00:00.000Z',
    needsAttention: true,
    retryable: true,
    retryRefusalReason: null,
    dismissedAt: null,
    dismissedByUserId: null,
    retryOfRunId: null,
    ...overrides,
  };
}

const label = (action: string): string => action;

describe('automationFailureTitle', () => {
  it.each(AUTOMATION_ACTION_VALUES)('should use %s own verb, never a generic sentence', (action) => {
    const title = automationFailureTitle(action, 'ol_order_1');
    expect(title).toContain('ol_order_1');
    // "an automation failed" tells the operator nothing about what to do next.
    expect(title.toLowerCase()).not.toContain('an automation failed');
    expect(title).not.toContain(action);
  });

  it('should name the raw action code when this build does not know it', () => {
    // A rule written by a newer backend must say something TRUE rather than
    // borrow a neighbour's verb.
    expect(automationFailureTitle('teleport-parcel', 'ol_order_1')).toContain('teleport-parcel');
  });

  it('should give six distinct titles', () => {
    const titles = new Set(AUTOMATION_ACTION_VALUES.map((a) => automationFailureTitle(a, 'x')));
    expect(titles.size).toBe(AUTOMATION_ACTION_VALUES.length);
  });
});

describe('stepReasonText', () => {
  it('should quote the operation verbatim and attribute it', () => {
    const text = stepReasonText(
      step({ report: { attributedTo: 'Allegro', message: 'Offer 123 is archived.' } }),
    );
    expect(text).toBe('Allegro said: Offer 123 is archived.');
  });

  it('should not re-word the reported message', () => {
    const message = 'DPD: pickup address is outside the service area (code 42)';
    const text = stepReasonText(step({ report: { attributedTo: 'DPD', message } }));
    // The AC: no re-wording layer sits between the operation and the string.
    expect(text).toContain(message);
  });

  it('should prefer the report over OpenLinker own sentence about it', () => {
    const text = stepReasonText(
      step({
        detail: 'Telling the marketplace failed: boom',
        report: { attributedTo: 'Allegro', message: 'boom' },
      }),
    );
    expect(text).toBe('Allegro said: boom');
  });

  it('should fall back to detail when nothing reported', () => {
    expect(stepReasonText(step({ detail: 'Something went wrong.' }))).toBe('Something went wrong.');
  });

  it('should be null when there is nothing to say', () => {
    expect(stepReasonText(step())).toBeNull();
  });
});

describe('retryRefusalCopy', () => {
  it('should not describe a deleted rule as a failure', () => {
    const copy = retryRefusalCopy('rule-deleted') ?? '';
    expect(copy.toLowerCase()).not.toContain('fail');
    expect(copy.toLowerCase()).not.toContain('error');
  });

  it('should name the cause for a return, not call it unsupported', () => {
    const copy = retryRefusalCopy('subject-unsupported') ?? '';
    expect(copy.toLowerCase()).toContain('return');
    expect(copy.toLowerCase()).not.toContain('not supported');
  });

  it('should render an unrecognised code as itself', () => {
    expect(retryRefusalCopy('some-new-reason')).toBe('some-new-reason');
  });

  it('should be null when nothing was refused', () => {
    expect(retryRefusalCopy(null)).toBeNull();
  });
});

describe('buildAutomationFailureView', () => {
  it('should be null for a firing that did not fail', () => {
    expect(buildAutomationFailureView(run({ outcome: 'done' }), label)).toBeNull();
  });

  it('should name the failing step and what did not run after it', () => {
    const view = buildAutomationFailureView(
      run({
        steps: [
          step({ stepIndex: 0, action: 'dispatch-shipment', status: 'failed', detail: 'nope' }),
          step({ stepIndex: 1, action: 'relay-status-to-source', status: 'skipped', detail: null }),
        ],
      }),
      label,
    );
    expect(view?.title).toContain('label');
    expect(view?.skipped).toContain('relay-status-to-source');
  });

  it('should count skipped steps when more than one did not run', () => {
    const view = buildAutomationFailureView(
      run({
        steps: [
          step({ stepIndex: 0, status: 'failed' }),
          step({ stepIndex: 1, status: 'skipped' }),
          step({ stepIndex: 2, status: 'skipped' }),
        ],
      }),
      label,
    );
    expect(view?.skipped).toContain('2');
  });

  it('should say so when a failed run carries no readable failed step', () => {
    // An empty line would read as "no reason, therefore no problem".
    const view = buildAutomationFailureView(run({ steps: [], unreadableStepCount: 2 }), label);
    expect(view?.reason.length).toBeGreaterThan(0);
    expect(view?.step).toBeNull();
  });
});
