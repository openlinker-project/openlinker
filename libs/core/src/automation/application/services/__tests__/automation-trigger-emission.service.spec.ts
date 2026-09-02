/**
 * AutomationTriggerEmissionService specs (#2360)
 */
import { AutomationRule } from '../../../domain/entities/automation-rule.entity';
import type { AutomationSubjectFacts } from '../../../domain/types/automation-facts.types';
import type { AutomationTrigger } from '../../../domain/types/automation-trigger.types';
import { AutomationTriggerEmissionService } from '../automation-trigger-emission.service';

const NOW = new Date('2026-09-10T12:00:00.000Z');
const CREATED = new Date('2026-09-01T00:00:00.000Z');

const EMAIL = {
  action: 'send-email' as const,
  recipient: { kind: 'address' as const, address: 'ops@example.com' },
  subject: 's',
  body: 'b',
};

function rule(id: string, trigger: AutomationTrigger, overrides: Partial<{ isActive: boolean; triggerConfig: unknown }> = {}): AutomationRule {
  return new AutomationRule(
    id, `Rule ${id}`, trigger,
    (overrides.triggerConfig ?? {}) as never,
    [], [EMAIL], 'hash',
    overrides.isActive ?? true,
    CREATED, null, null, null, CREATED, CREATED,
  );
}

const FACTS: AutomationSubjectFacts = {
  subjectKind: 'order',
  subjectId: 'ol_order_1',
  occurredAt: new Date('2026-09-10T11:00:00.000Z'),
};

describe('AutomationTriggerEmissionService', () => {
  let ruleRepository: { findByTrigger: jest.Mock };
  let firingRepository: { claim: jest.Mock };
  let dispatcher: { dispatch: jest.Mock };
  let service: AutomationTriggerEmissionService;

  beforeEach(() => {
    ruleRepository = { findByTrigger: jest.fn().mockResolvedValue([]) };
    firingRepository = { claim: jest.fn().mockResolvedValue(true) };
    dispatcher = { dispatch: jest.fn().mockResolvedValue(undefined) };
    service = new AutomationTriggerEmissionService(
      ruleRepository as never, firingRepository as never, dispatcher as never,
    );
  });

  it('should dispatch a matching rule and report it as fired', async () => {
    ruleRepository.findByTrigger.mockResolvedValue([rule('a', 'order.packed')]);
    const result = await service.emit({ trigger: 'order.packed', facts: FACTS, now: NOW });
    expect(result.firedRuleIds).toEqual(['a']);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
  });

  it('should NOT claim a firing record for an edge trigger', async () => {
    // The write that caused an edge trigger happens once; a record would be
    // durable state bought for nothing.
    ruleRepository.findByTrigger.mockResolvedValue([rule('a', 'order.packed')]);
    await service.emit({ trigger: 'order.packed', facts: FACTS, now: NOW });
    expect(firingRepository.claim).not.toHaveBeenCalled();
  });

  it('should claim a firing record for a deadline-sweep trigger', async () => {
    ruleRepository.findByTrigger.mockResolvedValue([
      rule('a', 'order.dispatch_deadline_near', { triggerConfig: { hoursBefore: 24 } }),
    ]);
    await service.emit({ trigger: 'order.dispatch_deadline_near', facts: FACTS, now: NOW });
    expect(firingRepository.claim).toHaveBeenCalledWith({
      ruleId: 'a', subjectKind: 'order', subjectId: 'ol_order_1', firedAt: NOW,
    });
  });

  it('should not dispatch a rule whose claim was lost, and report it separately', async () => {
    ruleRepository.findByTrigger.mockResolvedValue([
      rule('a', 'order.dispatch_deadline_near', { triggerConfig: { hoursBefore: 24 } }),
    ]);
    firingRepository.claim.mockResolvedValue(false);
    const result = await service.emit({ trigger: 'order.dispatch_deadline_near', facts: FACTS, now: NOW });
    expect(result.firedRuleIds).toEqual([]);
    expect(result.alreadyFiredRuleIds).toEqual(['a']);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('should drop ONLY the rule that lost its claim', async () => {
    ruleRepository.findByTrigger.mockResolvedValue([
      rule('a', 'order.dispatch_deadline_near', { triggerConfig: { hoursBefore: 24 } }),
      rule('b', 'order.dispatch_deadline_near', { triggerConfig: { hoursBefore: 24 } }),
    ]);
    firingRepository.claim.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const result = await service.emit({ trigger: 'order.dispatch_deadline_near', facts: FACTS, now: NOW });
    expect(result.firedRuleIds).toEqual(['b']);
  });

  it('should load inactive rules too and let the evaluator exclude them', async () => {
    // Pre-filtering to active in SQL would delete the `rule-inactive` reason the
    // #2363 dry run needs to say "your rule is switched off".
    ruleRepository.findByTrigger.mockResolvedValue([rule('a', 'order.packed', { isActive: false })]);
    const result = await service.emit({ trigger: 'order.packed', facts: FACTS, now: NOW });
    expect(result.evaluatedRuleCount).toBe(1);
    expect(result.firedRuleIds).toEqual([]);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('should not dispatch at all when no rule matched', async () => {
    ruleRepository.findByTrigger.mockResolvedValue([rule('a', 'return.received')]);
    await service.emit({ trigger: 'order.packed', facts: FACTS, now: NOW });
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('should pass the caller-supplied now straight through, never a clock read', async () => {
    ruleRepository.findByTrigger.mockResolvedValue([rule('a', 'order.packed')]);
    await service.emit({ trigger: 'order.packed', facts: FACTS, now: NOW });
    expect(dispatcher.dispatch).toHaveBeenCalledWith(expect.objectContaining({ now: NOW }));
  });
});
