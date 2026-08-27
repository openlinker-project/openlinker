/**
 * Automation Irreversible-Action Gate Service Tests (#2362, Wave-2 spec §5.5 / §5.6)
 */
import { AutomationRule } from '../../../domain/entities/automation-rule.entity';
import type { AutomationAction } from '../../../domain/types/automation-action.types';
import type { AutomationSubjectFacts } from '../../../domain/types/automation-facts.types';
import type { AutomationTrigger } from '../../../domain/types/automation-trigger.types';
import type { IAutomationRunRecorderService } from '../../interfaces/automation-run-recorder.service.interface';
import type { AutomationDispatchService } from '../automation-dispatch.service';
import { AutomationIrreversibleGateService } from '../automation-irreversible-gate.service';

const NOW = new Date('2026-09-10T12:00:00.000Z');
const AT = new Date('2026-09-01T00:00:00.000Z');

const ISSUE_DOC: AutomationAction = { action: 'issue-sales-document' };
const DISPATCH: AutomationAction = {
  action: 'dispatch-shipment',
  carrierId: 'carrier-1',
  serviceId: null,
  packagePresetId: null,
  cashOnDelivery: false,
};
const EMAIL: AutomationAction = {
  action: 'send-email',
  recipient: { kind: 'address', address: 'ops@example.com' },
  subject: 'Hello',
  body: 'Something happened.',
};

const FACTS: AutomationSubjectFacts = {
  subjectKind: 'order',
  subjectId: 'ol_order_1',
  occurredAt: NOW,
};

function rule(id: string, actions: readonly AutomationAction[]): AutomationRule {
  return new AutomationRule(
    id,
    `Rule ${id}`,
    'order.packed' as AutomationTrigger,
    {},
    [],
    actions,
    'hash',
    true,
    AT,
    null,
    null,
    null,
    AT,
    AT,
  );
}

describe('AutomationIrreversibleGateService', () => {
  let dispatcher: jest.Mocked<Pick<AutomationDispatchService, 'dispatch'>>;
  let recorder: jest.Mocked<IAutomationRunRecorderService>;
  let service: AutomationIrreversibleGateService;

  beforeEach(() => {
    // The gate injects the CONCRETE `AutomationDispatchService`, matching the
    // local precedent (`AutomationDispatchService` injects
    // `AutomationActionExecutorRegistry`; both executors inject
    // `AutomationDelegateResolverService`) — a decorator needs a handle on what
    // it decorates, and the token is already taken by the gate itself. Hence
    // the cast: only `dispatch` is exercised, so a structural stub is enough.
    dispatcher = { dispatch: jest.fn().mockResolvedValue(undefined) };
    recorder = { persistsRuns: false, record: jest.fn().mockResolvedValue(undefined) };
    service = new AutomationIrreversibleGateService(
      dispatcher as unknown as AutomationDispatchService,
      recorder,
    );
  });

  const dispatch = (matchedRules: readonly AutomationRule[]): Promise<void> =>
    service.dispatch({ trigger: 'order.packed' as AutomationTrigger, facts: FACTS, matchedRules, now: NOW });

  describe('when no irreversible action collides', () => {
    it('should delegate every rule unchanged and record nothing itself (AC 2)', async () => {
      const rules = [rule('a', [EMAIL]), rule('b', [EMAIL])];

      await dispatch(rules);

      expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
      expect(dispatcher.dispatch).toHaveBeenCalledWith({
        trigger: 'order.packed',
        facts: FACTS,
        matchedRules: rules,
        now: NOW,
      });
      // The dispatcher records its own runs; the gate records only blocks.
      expect(recorder.record).not.toHaveBeenCalled();
    });

    it('should delegate a lone irreversible rule', async () => {
      const rules = [rule('a', [ISSUE_DOC])];

      await dispatch(rules);

      expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
      expect(recorder.record).not.toHaveBeenCalled();
    });

    it('should delegate an A1 rule beside an A2 rule — different resources', async () => {
      const rules = [rule('a', [ISSUE_DOC]), rule('b', [DISPATCH])];

      await dispatch(rules);

      const call = dispatcher.dispatch.mock.calls[0]?.[0];
      expect(call?.matchedRules).toEqual(rules);
      expect(recorder.record).not.toHaveBeenCalled();
    });
  });

  describe('when two rules claim the same irreversible action', () => {
    it('should dispatch NOTHING (AC 1)', async () => {
      await dispatch([rule('a', [ISSUE_DOC]), rule('b', [ISSUE_DOC])]);

      expect(dispatcher.dispatch).not.toHaveBeenCalled();
    });

    it('should record one blocked run per rule, each naming BOTH rules (AC 1)', async () => {
      await dispatch([rule('a', [ISSUE_DOC]), rule('b', [ISSUE_DOC])]);

      expect(recorder.record).toHaveBeenCalledTimes(2);
      const records = recorder.record.mock.calls.map(([record]) => record);

      for (const record of records) {
        expect(record.outcome).toBe('blocked');
        // §5.6: the row says WHICH rules collided; a single ruleId names one.
        expect(record.blockedByRuleIds).toEqual(['a', 'b']);
        expect(record.trigger).toBe('order.packed');
        expect(record.facts).toBe(FACTS);
        expect(record.firedAt).toBe(NOW);
        // Nothing ran, so no step is claimed to have been reached.
        expect(record.steps).toEqual([]);
      }
      expect(records.map((record) => record.rule.id)).toEqual(['a', 'b']);
    });

    it('should still dispatch the reversible rules that matched the same subject', async () => {
      const email = rule('email-1', [EMAIL]);
      await dispatch([rule('doc-1', [ISSUE_DOC]), email, rule('doc-2', [ISSUE_DOC])]);

      expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
      expect(dispatcher.dispatch.mock.calls[0]?.[0].matchedRules).toEqual([email]);
      expect(recorder.record).toHaveBeenCalledTimes(2);
    });

    it('should carry the trigger, facts and now through to the delegated dispatch unchanged', async () => {
      const email = rule('email-1', [EMAIL]);
      await dispatch([rule('doc-1', [ISSUE_DOC]), rule('doc-2', [ISSUE_DOC]), email]);

      expect(dispatcher.dispatch).toHaveBeenCalledWith({
        trigger: 'order.packed',
        facts: FACTS,
        matchedRules: [email],
        now: NOW,
      });
    });
  });

  describe('reporting failures', () => {
    it('should still dispatch the unblocked rules when recording a block throws', async () => {
      recorder.record.mockRejectedValueOnce(new Error('recorder down'));
      const email = rule('email-1', [EMAIL]);

      await expect(
        dispatch([rule('doc-1', [ISSUE_DOC]), rule('doc-2', [ISSUE_DOC]), email]),
      ).resolves.toBeUndefined();

      expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
      expect(dispatcher.dispatch.mock.calls[0]?.[0].matchedRules).toEqual([email]);
    });

    it('should still record the second block when the first one throws', async () => {
      recorder.record.mockRejectedValueOnce(new Error('recorder down'));

      await dispatch([rule('a', [ISSUE_DOC]), rule('b', [ISSUE_DOC])]);

      expect(recorder.record).toHaveBeenCalledTimes(2);
    });
  });

  it('should not call the dispatcher at all when the matched set is empty', async () => {
    await dispatch([]);

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(recorder.record).not.toHaveBeenCalled();
  });
});
