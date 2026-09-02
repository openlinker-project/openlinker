/**
 * `Try again` (#2387)
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AUTOMATION_MAX_RETRY_ATTEMPTS } from '@openlinker/core/automation';
import type {
  AutomationRunView,
  IAutomationDispatchService,
  IAutomationRulesService,
  IAutomationRunsReadService,
} from '@openlinker/core/automation';
import type { IOrderRecordService } from '@openlinker/core/orders';

import { AutomationRetryService } from '../automation-retry.service';

function view(overrides: Partial<AutomationRunView> = {}): AutomationRunView {
  return {
    id: 'run-1',
    ruleId: 'rule-1',
    ruleName: 'Ship paid orders',
    trigger: 'order.packed',
    subjectKind: 'order',
    subjectId: 'ol_order_1',
    outcome: 'failed',
    steps: [],
    blockedByRuleIds: null,
    firedAt: new Date('2026-08-20T10:00:00.000Z'),
    createdAt: new Date('2026-08-20T10:00:00.000Z'),
    dismissedAt: null,
    dismissedByUserId: null,
    retryOfRunId: null,
    retryAttempt: 0,
    supersededByRetry: false,
    needsAttention: true,
    retry: { retryable: true },
    ...overrides,
  } as AutomationRunView;
}

describe('AutomationRetryService', () => {
  let runs: jest.Mocked<IAutomationRunsReadService>;
  let rules: jest.Mocked<IAutomationRulesService>;
  let orders: jest.Mocked<IOrderRecordService>;
  let dispatcher: jest.Mocked<IAutomationDispatchService>;
  let service: AutomationRetryService;

  const rule = { id: 'rule-1', name: 'Ship paid orders', actions: [] };
  const record = {
    internalOrderId: 'ol_order_1',
    sourceConnectionId: 'conn-1',
    orderSnapshot: {},
    totalAmount: 10,
    currency: 'PLN',
    placedAt: new Date('2026-08-19T09:00:00.000Z'),
    createdAt: new Date('2026-08-19T09:00:00.000Z'),
  };

  beforeEach(() => {
    runs = { getRunById: jest.fn().mockResolvedValue(view()) } as unknown as jest.Mocked<IAutomationRunsReadService>;
    rules = { getRule: jest.fn().mockResolvedValue(rule) } as unknown as jest.Mocked<IAutomationRulesService>;
    orders = { getOrderRecord: jest.fn().mockResolvedValue(record) } as unknown as jest.Mocked<IOrderRecordService>;
    dispatcher = { dispatch: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<IAutomationDispatchService>;
    service = new AutomationRetryService(runs, rules, orders, dispatcher);
  });

  it('should dispatch only the named rule, linked back to the run it retries', async () => {
    await service.retry({ runId: 'run-1' });

    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
    const input = dispatcher.dispatch.mock.calls[0]?.[0];
    expect(input?.matchedRules).toHaveLength(1);
    expect(input?.matchedRules[0]).toBe(rule);
    // The link is what lets the derived attention state clear on success
    // WITHOUT a later unrelated firing of the same rule clearing it.
    expect(input?.retryOf?.runId).toBe('run-1');
    expect(input?.trigger).toBe('order.packed');
  });

  it('should stamp the chain position as the parent attempt plus one (#2666)', async () => {
    runs.getRunById.mockResolvedValue(view({ retryAttempt: 1 }));

    await service.retry({ runId: 'run-1' });

    // The link and the counter travel as ONE value, so a retry cannot be
    // recorded without advancing the budget it is spending — a caller that set
    // one and forgot the other would restart the budget on every chain.
    expect(dispatcher.dispatch.mock.calls[0]?.[0]?.retryOf).toEqual({
      runId: 'run-1',
      attempt: 2,
    });
  });

  it('should refuse and NOT dispatch once the chain has spent its budget (#2666)', async () => {
    runs.getRunById.mockResolvedValue(view({ retryAttempt: AUTOMATION_MAX_RETRY_ATTEMPTS }));

    await expect(service.retry({ runId: 'run-1' })).rejects.toMatchObject({
      response: { reason: 'retry-exhausted' },
    });
    // The refusal must precede the side effect, or the terminal state is a
    // label on work that already ran.
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('should refuse and NOT dispatch a retry of an already-superseded run (#2666)', async () => {
    runs.getRunById.mockResolvedValue(view({ supersededByRetry: true }));

    await expect(service.retry({ runId: 'run-1' })).rejects.toMatchObject({
      response: { reason: 'superseded' },
    });
    // This is the FORK guard, and it must live HERE and not only in the UI: the
    // frontend hides the control on a superseded row, but a direct call would
    // otherwise mint a second chain head whose budget restarts at 1.
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('should hand the gate exactly ONE rule, which it can never refuse', async () => {
    // Stated as a test because the plan states it: the injected dependency is
    // the #2362 gate (bound to AUTOMATION_DISPATCH_SERVICE_TOKEN), and
    // `gateIrreversibleAutomationActions` only collides when two or more rules
    // claim the same irreversible action. So this path always passes the gate,
    // and the gate is NOT what protects against duplicate money — executor
    // idempotency is. If a future change makes a retry carry a SET, this test
    // fails and the protection question has to be re-answered rather than
    // silently assumed.
    await service.retry({ runId: 'run-1' });
    expect(dispatcher.dispatch.mock.calls[0]?.[0].matchedRules).toHaveLength(1);
  });

  it('should re-read the ORIGINAL run so the caller sees its attention state', async () => {
    runs.getRunById
      .mockResolvedValueOnce(view())
      .mockResolvedValueOnce(view({ needsAttention: false }));

    const result = await service.retry({ runId: 'run-1' });

    expect(result.needsAttention).toBe(false);
    expect(runs.getRunById).toHaveBeenCalledTimes(2);
  });

  it('should not re-evaluate the rule conditions', async () => {
    // Re-evaluating would re-apply the retroactivity floor and refuse every
    // retry of an older firing.
    await service.retry({ runId: 'run-1' });
    expect(rules.listRulesByTrigger).toBeUndefined();
  });

  it('should refuse a run that did not fail', async () => {
    runs.getRunById.mockResolvedValue(
      view({ outcome: 'done', retry: { retryable: false, reason: 'not-failed' } }),
    );
    await expect(service.retry({ runId: 'run-1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('should refuse a return, naming the cause', async () => {
    runs.getRunById.mockResolvedValue(view({ subjectKind: 'return' }));
    await expect(service.retry({ runId: 'run-1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('should refuse when the rule has been deleted, without touching the run', async () => {
    rules.getRule.mockResolvedValue(null);
    await expect(service.retry({ runId: 'run-1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('should carry the refusal reason on the error, so a client renders one sentence', async () => {
    rules.getRule.mockResolvedValue(null);
    await service.retry({ runId: 'run-1' }).catch((error: unknown) => {
      const response = (error as BadRequestException).getResponse();
      expect(response).toMatchObject({ reason: 'rule-deleted' });
    });
    expect.assertions(1);
  });

  it('should 404 an unknown run', async () => {
    runs.getRunById.mockResolvedValue(null);
    await expect(service.retry({ runId: 'nope' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should 404 when the order behind the run is gone', async () => {
    orders.getOrderRecord.mockResolvedValue(null);
    await expect(service.retry({ runId: 'run-1' })).rejects.toBeInstanceOf(NotFoundException);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });
});
