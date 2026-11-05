/**
 * GiftAttentionController specs (#3935)
 *
 * @module apps/api/src/automation/http/__tests__
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AutomationRunView, IAutomationRunsReadService } from '@openlinker/core/automation';

import type { AuthenticatedUser } from '../../../auth/auth.types';
import { GiftAttentionController } from '../gift-attention.controller';

const USER = { id: 'user-1' } as AuthenticatedUser;

function run(overrides: Record<string, unknown> = {}): AutomationRunView {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    ruleId: 'rule-1',
    ruleName: 'Promo',
    trigger: 'order.ingested',
    subjectKind: 'order',
    subjectId: 'o1',
    outcome: 'nothing-to-do',
    steps: [{ action: 'add-gift', reasonCode: 'gift-out-of-stock', detail: 'secret cost 3.20' }],
    blockedByRuleIds: null,
    firedAt: new Date('2026-11-02T10:00:00Z'),
    createdAt: new Date('2026-11-02T10:00:00Z'),
    dismissedAt: null,
    dismissedByUserId: null,
    retryOfRunId: null,
    retryAttempt: 0,
    needsAttention: false,
    retry: { retryable: false },
    supersededByRetry: false,
    ...overrides,
  } as unknown as AutomationRunView;
}

function build(runs: AutomationRunView[], byId: AutomationRunView | null = null) {
  const service = {
    listRecentBySubject: jest.fn().mockResolvedValue({ runs, limit: 200, hasMore: false, recordingAvailable: true }),
    getRunById: jest.fn().mockResolvedValue(byId),
    dismiss: jest.fn().mockImplementation((id: string) => Promise.resolve(run({ id, dismissedAt: new Date() }))),
  } as unknown as jest.Mocked<IAutomationRunsReadService>;
  return { controller: new GiftAttentionController(service), service };
}

describe('GiftAttentionController', () => {
  it('should list only add-gift runs that did not give the gift, as codes without step detail', async () => {
    const other = run({ id: 'other', ruleId: 'r2', steps: [{ action: 'send-email' }] });
    const done = run({ id: 'done', ruleId: 'r3', outcome: 'done' });
    const { controller } = build([run(), other, done]);
    const result = await controller.list('o1');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ ruleId: 'rule-1', reasonCode: 'gift-out-of-stock', outcome: 'not-applied', dismissed: false });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('should read the reason from the sentence on an older run and report a failed run without a code', async () => {
    const old = run({ steps: [{ action: 'add-gift', detail: 'No gift added: customer-limit-reached.' }] });
    const failed = run({ id: 'f', ruleId: 'r9', outcome: 'failed' });
    const { controller } = build([old, failed]);
    const result = await controller.list('o1');
    expect(result.items.find((i) => i.ruleId === 'rule-1')?.reasonCode).toBe('customer-limit-reached');
    expect(result.items.find((i) => i.ruleId === 'r9')).toMatchObject({ outcome: 'failed', reasonCode: null });
  });

  it('should dismiss an add-gift run of this order', async () => {
    const target = run();
    const { controller, service } = build([], target);
    const item = await controller.skip('o1', target.id, USER);
    expect(service.dismiss).toHaveBeenCalledWith(target.id, 'user-1', expect.any(Date));
    expect(item.dismissed).toBe(true);
  });

  it('should answer 404 for a run that belongs to another order or does not exist', async () => {
    const foreign = run({ subjectId: 'o2' });
    await expect(build([], foreign).controller.skip('o1', foreign.id, USER)).rejects.toBeInstanceOf(NotFoundException);
    await expect(build([], null).controller.skip('o1', foreign.id, USER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should answer 409 and dismiss nothing for a run that is not an add-gift run', async () => {
    const email = run({ steps: [{ action: 'send-email' }] });
    const { controller, service } = build([], email);
    await expect(controller.skip('o1', email.id, USER)).rejects.toBeInstanceOf(ConflictException);
    expect(service.dismiss).not.toHaveBeenCalled();
  });
});
