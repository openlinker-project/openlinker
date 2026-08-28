/**
 * AutomationTriggerDeadlineSweepHandler specs (#2360)
 *
 * The `occurredAt` test is the important one: it pins the CROSSING-not-deadline
 * rule, whose inversion would clear #2359's retroactivity floor unconditionally
 * and buy a label for every order already inside a new rule's window.
 */
import {
  evaluateAutomationRules,
  type AutomationEvaluationInput,
  type AutomationRule,
} from '@openlinker/core/automation';

import { AutomationTriggerDeadlineSweepHandler } from '../automation-trigger-deadline-sweep.handler';

const NOW_MS = new Date('2026-09-10T12:00:00.000Z').getTime();

function makeJob() {
  return { id: 'job-1', jobType: 'automation.trigger.deadlineSweep', connectionId: 'conn-1', payload: {} } as never;
}

describe('AutomationTriggerDeadlineSweepHandler', () => {
  let orderRecords: { findDispatchDeadlineCandidates: jest.Mock };
  let rules: { listRulesByTrigger: jest.Mock };
  let emission: { emit: jest.Mock };
  let cursors: { getCursor: jest.Mock; advanceCursor: jest.Mock };
  let locks: { acquire: jest.Mock; release: jest.Mock };
  let handler: AutomationTriggerDeadlineSweepHandler;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW_MS);
    orderRecords = { findDispatchDeadlineCandidates: jest.fn().mockResolvedValue([]) };
    rules = { listRulesByTrigger: jest.fn().mockResolvedValue([{ triggerConfig: { hoursBefore: 24 } }]) };
    emission = { emit: jest.fn().mockResolvedValue({ firedRuleIds: [], alreadyFiredRuleIds: [], evaluatedRuleCount: 1 }) };
    cursors = { getCursor: jest.fn().mockResolvedValue(null), advanceCursor: jest.fn().mockResolvedValue(undefined) };
    locks = { acquire: jest.fn().mockResolvedValue('token'), release: jest.fn().mockResolvedValue(true) };
    handler = new AutomationTriggerDeadlineSweepHandler(
      orderRecords as never, rules as never, emission as never, cursors as never, locks as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  function candidate(dispatchByAt: Date, overrides: Record<string, unknown> = {}) {
    return {
      internalOrderId: 'ol_order_1',
      dispatchByAt,
      sourceConnectionId: 'conn-1',
      // `buildOrderAutomationFacts` reads all four — a candidate narrowed to
      // three fields is what made the §5.4-legal conditions unmatchable.
      orderSnapshot: { shippingAddress: { countryIso2: 'PL' } },
      totalAmount: 750,
      currency: 'PLN',
      ...overrides,
    };
  }

  function rule(overrides: Partial<AutomationRule> & { id: string }): AutomationRule {
    return {
      name: `rule ${overrides.id}`,
      trigger: 'order.dispatch_deadline_near',
      triggerConfig: {},
      conditions: [],
      actions: [
        { action: 'send-email', recipient: { kind: 'buyer' }, subject: 'Deadline', body: 'Soon.' },
      ],
      definitionHash: `hash-${overrides.id}`,
      isActive: true,
      effectiveFrom: new Date(NOW_MS - 90 * 24 * 3600_000),
      effectiveTo: null,
      moneyAckByUserId: null,
      moneyAckAt: null,
      createdAt: new Date(NOW_MS - 90 * 24 * 3600_000),
      updatedAt: new Date(NOW_MS - 90 * 24 * 3600_000),
      ...overrides,
    } as AutomationRule;
  }

  /**
   * Drive the REAL evaluator from the fake emission, so these two tests observe
   * the grouping and the facts projection rather than the handler's own
   * bookkeeping. Mocking `emission.emit` is exactly what let both blockers ship.
   */
  function useRealEvaluator(): string[] {
    const fired: string[] = [];
    emission.emit.mockImplementation((input: AutomationEvaluationInput) => {
      const result = evaluateAutomationRules(input);
      fired.push(...result.matched.map((evaluation) => evaluation.ruleId));
      return Promise.resolve({
        firedRuleIds: result.matched.map((evaluation) => evaluation.ruleId),
        alreadyFiredRuleIds: [],
        evaluatedRuleCount: result.evaluations.length,
      });
    });
    return fired;
  }

  it('should evaluate each rule ONLY at its own threshold crossing', async () => {
    // Deadline 20h out. The 24h crossing has passed; the 2h crossing has not.
    // Handing every rule to every crossing fires the 2h rule 18 hours early —
    // and because the firing claim is (rule, subject), that is the only firing
    // it ever gets.
    rules.listRulesByTrigger.mockResolvedValue([
      rule({ id: 'r24', triggerConfig: { hoursBefore: 24 } }),
      rule({ id: 'r2', triggerConfig: { hoursBefore: 2 } }),
    ]);
    orderRecords.findDispatchDeadlineCandidates.mockResolvedValue([
      candidate(new Date(NOW_MS + 20 * 3600_000)),
    ]);
    const fired = useRealEvaluator();

    await handler.execute(makeJob());

    expect(fired).toEqual(['r24']);
    // One emission, for the one crossing that has passed — and it carried only
    // that threshold's rules.
    expect(emission.emit).toHaveBeenCalledTimes(1);
    const passed = (emission.emit.mock.calls[0] as [AutomationEvaluationInput])[0];
    expect(passed.rules.map((r) => r.id)).toEqual(['r24']);
  });

  it('should supply the facts a §5.4-legal orderTotalGross condition needs', async () => {
    rules.listRulesByTrigger.mockResolvedValue([
      rule({
        id: 'r-total',
        triggerConfig: { hoursBefore: 24 },
        conditions: [
          { field: 'orderTotalGross', op: 'gte', amount: '500', currency: 'PLN' },
        ],
      }),
    ]);
    orderRecords.findDispatchDeadlineCandidates.mockResolvedValue([
      candidate(new Date(NOW_MS + 10 * 3600_000)),
    ]);
    const fired = useRealEvaluator();

    await handler.execute(makeJob());

    // A hand-built 4-field facts literal leaves `totalGross` undefined, the
    // condition reads `unknown`, and this rule saves, arms and never fires.
    expect(fired).toEqual(['r-total']);
  });

  it('should pass occurredAt as the CROSSING, never the deadline', async () => {
    // Deadline 10h out, rule window 24h → the crossing was 14h AGO.
    const deadline = new Date(NOW_MS + 10 * 3600_000);
    orderRecords.findDispatchDeadlineCandidates.mockResolvedValue([candidate(deadline)]);

    await handler.execute(makeJob());

    const facts = (emission.emit.mock.calls[0] as [{ facts: { occurredAt: Date } }])[0].facts;
    expect(facts.occurredAt.getTime()).toBe(deadline.getTime() - 24 * 3600_000);
    // The inversion this guards against: occurredAt must NOT be the deadline,
    // which is in the future and would clear the retroactivity floor always.
    expect(facts.occurredAt.getTime()).not.toBe(deadline.getTime());
    expect(facts.occurredAt.getTime()).toBeLessThan(NOW_MS);
  });

  it('should not emit for a candidate whose window has not been entered yet', async () => {
    // Deadline 100h out, window 24h → the crossing is 76h in the future.
    orderRecords.findDispatchDeadlineCandidates.mockResolvedValue([
      candidate(new Date(NOW_MS + 100 * 3600_000)),
    ]);
    await handler.execute(makeJob());
    expect(emission.emit).not.toHaveBeenCalled();
  });

  it('should skip entirely and clear the cursor when no armed rule has a threshold', async () => {
    rules.listRulesByTrigger.mockResolvedValue([]);
    await handler.execute(makeJob());
    expect(orderRecords.findDispatchDeadlineCandidates).not.toHaveBeenCalled();
    expect(cursors.advanceCursor).toHaveBeenCalledWith('conn-1', expect.any(String), '');
  });

  it('should serialise on a per-connection lock and release it', async () => {
    await handler.execute(makeJob());
    expect(locks.acquire).toHaveBeenCalledWith('automation:deadline-sweep:conn-1', expect.any(Number));
    expect(locks.release).toHaveBeenCalledWith('automation:deadline-sweep:conn-1', 'token');
  });

  it('should no-op when the lock is held by a concurrent run', async () => {
    locks.acquire.mockResolvedValue(null);
    await handler.execute(makeJob());
    expect(orderRecords.findDispatchDeadlineCandidates).not.toHaveBeenCalled();
  });

  it('should clear the cursor when the page is short (cycle complete)', async () => {
    orderRecords.findDispatchDeadlineCandidates.mockResolvedValue([
      candidate(new Date(NOW_MS + 10 * 3600_000)),
    ]);
    await handler.execute(makeJob());
    expect(cursors.advanceCursor).toHaveBeenCalledWith('conn-1', expect.any(String), '');
  });

  it('should advance the cursor by rows READ, not by rows that fired', async () => {
    // A pair that lost its claim still consumed a row; paging by outcome would
    // re-read it forever.
    const full = Array.from({ length: 200 }, () => candidate(new Date(NOW_MS + 10 * 3600_000)));
    orderRecords.findDispatchDeadlineCandidates.mockResolvedValue(full);
    emission.emit.mockResolvedValue({ firedRuleIds: [], alreadyFiredRuleIds: ['a'], evaluatedRuleCount: 1 });
    await handler.execute(makeJob());
    expect(cursors.advanceCursor).toHaveBeenCalledWith('conn-1', expect.any(String), '200');
  });

  it('should start a fresh cycle on a malformed cursor rather than wedging', async () => {
    cursors.getCursor.mockResolvedValue('not-a-number');
    orderRecords.findDispatchDeadlineCandidates.mockResolvedValue([]);
    await handler.execute(makeJob());
    expect(orderRecords.findDispatchDeadlineCandidates).toHaveBeenCalledWith(
      'conn-1', expect.objectContaining({ offset: 0 }),
    );
  });
});
