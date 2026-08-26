/**
 * Automation action executor specs (#2361)
 */
import { AutomationRule } from '../../../../domain/entities/automation-rule.entity';
import type { AutomationAction } from '../../../../domain/types/automation-action.types';
import { AutomationActionValues } from '../../../../domain/types/automation-action.types';
import type { AutomationSubjectFacts } from '../../../../domain/types/automation-facts.types';
import { AutomationActionExecutorRegistry } from '../../automation-action-executor.registry';
import type { AutomationDelegateResolverService } from '../../automation-delegate-resolver.service';
import { RelayStatusToSourceExecutorService } from '../relay-status-to-source-executor.service';
import { SendEmailExecutorService } from '../send-email-executor.service';
import {
  AUTOMATION_UNAVAILABLE_ACTION_REASONS,
  UnavailableActionExecutorService,
} from '../unavailable-action-executor.service';

const NOW = new Date('2026-09-10T12:00:00.000Z');
const CREATED = new Date('2026-09-01T00:00:00.000Z');
const FACTS: AutomationSubjectFacts = { subjectKind: 'order', subjectId: 'ol_order_1' };

const RULE = new AutomationRule(
  'r1', 'Notify ops', 'order.packed', {} as never, [], [{ action: 'relay-status-to-source' }],
  'hash', true, CREATED, null, null, null, CREATED, CREATED,
);

/** A resolver whose answers per barrel/token the test dictates. */
function stubResolver(answers: Record<string, unknown>): AutomationDelegateResolverService {
  return {
    resolve: (ref: { tokenName: string }) => answers[ref.tokenName] ?? null,
  } as unknown as AutomationDelegateResolverService;
}

function input(action: AutomationAction, facts: AutomationSubjectFacts = FACTS) {
  return { action, facts, rule: RULE, stepIndex: 0, now: NOW };
}

describe('UnavailableActionExecutorService', () => {
  const executor = new UnavailableActionExecutorService();

  it.each([
    ['issue-sales-document'],
    ['dispatch-shipment'],
    ['place-hold'],
    ['release-hold'],
  ])('should fail %s with a reason naming the blocking gap', async (action) => {
    const result = await executor.execute(
      input({ action } as unknown as AutomationAction),
    );
    expect(result.status).toBe('failed');
    expect(result.unavailableReason).toBeDefined();
    expect(result.unavailableReason).toBe(result.detail);
  });

  it('should name #2339 for both hold actions so an operator can find the work', () => {
    expect(AUTOMATION_UNAVAILABLE_ACTION_REASONS['place-hold']).toContain('#2339');
    expect(AUTOMATION_UNAVAILABLE_ACTION_REASONS['release-hold']).toContain('#2339');
  });
});

describe('RelayStatusToSourceExecutorService', () => {
  it('should report done when at least one channel accepted the update', async () => {
    const relay = { relay: jest.fn().mockResolvedValue({ targets: [{ connectionId: 'c1', outcome: 'applied' }] }) };
    const executor = new RelayStatusToSourceExecutorService(
      stubResolver({ ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN: relay }),
    );

    const result = await executor.execute(input({ action: 'relay-status-to-source' }));

    expect(result.status).toBe('done');
    expect(relay.relay).toHaveBeenCalledWith(
      expect.objectContaining({ internalOrderId: 'ol_order_1' }),
    );
  });

  it('should NOT pass the order source connection as the relay origin', async () => {
    // originConnectionId EXCLUDES that participant, so passing the source would
    // suppress exactly the marketplace this action exists to notify.
    const origins: string[] = [];
    const relay = {
      relay: (relayInput: { originConnectionId: string }) => {
        origins.push(relayInput.originConnectionId);
        return Promise.resolve({ targets: [] });
      },
    };
    const executor = new RelayStatusToSourceExecutorService(
      stubResolver({ ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN: relay }),
    );

    await executor.execute(
      input({ action: 'relay-status-to-source' }, { ...FACTS, sourceConnectionId: 'src-1' }),
    );

    expect(origins).toEqual(['openlinker:automation']);
  });

  it('should report nothing-to-do when no participant accepts status updates', async () => {
    const relay = { relay: jest.fn().mockResolvedValue({ targets: [] }) };
    const executor = new RelayStatusToSourceExecutorService(
      stubResolver({ ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN: relay }),
    );
    const result = await executor.execute(input({ action: 'relay-status-to-source' }));
    expect(result.status).toBe('nothing-to-do');
  });

  it('should carry the per-target reason so an operator can act on it', async () => {
    const relay = {
      relay: jest.fn().mockResolvedValue({
        targets: [{ connectionId: 'c1', outcome: 'rejected', detail: 'token expired' }],
      }),
    };
    const executor = new RelayStatusToSourceExecutorService(
      stubResolver({ ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN: relay }),
    );
    const result = await executor.execute(input({ action: 'relay-status-to-source' }));
    expect(result.detail).toContain('token expired');
  });

  it('should report nothing-to-do for a return subject rather than relaying a return id', async () => {
    const relay = { relay: jest.fn() };
    const executor = new RelayStatusToSourceExecutorService(
      stubResolver({ ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN: relay }),
    );
    const result = await executor.execute(
      input({ action: 'relay-status-to-source' }, { subjectKind: 'return', subjectId: 'ol_return_1' }),
    );
    expect(result.status).toBe('nothing-to-do');
    expect(relay.relay).not.toHaveBeenCalled();
  });

  it('should fail (not throw) when the relay is not wired into this process', async () => {
    const executor = new RelayStatusToSourceExecutorService(stubResolver({}));
    const result = await executor.execute(input({ action: 'relay-status-to-source' }));
    expect(result.status).toBe('failed');
  });

  it('should fail (not throw) when the relay itself throws', async () => {
    const relay = { relay: jest.fn().mockRejectedValue(new Error('boom')) };
    const executor = new RelayStatusToSourceExecutorService(
      stubResolver({ ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN: relay }),
    );
    const result = await executor.execute(input({ action: 'relay-status-to-source' }));
    expect(result.status).toBe('failed');
    expect(result.detail).toContain('boom');
  });
});

describe('SendEmailExecutorService', () => {
  const EMAIL_TO_ADDRESS: AutomationAction = {
    action: 'send-email',
    recipient: { kind: 'address', address: 'ops@example.com' },
    subject: 'Order {order.reference}',
    body: 'Automation {rule.name} fired for {order.reference}.',
  };
  const EMAIL_TO_BUYER: AutomationAction = {
    ...EMAIL_TO_ADDRESS,
    recipient: { kind: 'buyer' },
  } as AutomationAction;

  it('should send to a fixed address with merge fields rendered', async () => {
    const mailer = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    const executor = new SendEmailExecutorService(stubResolver({ MAILER_TOKEN: mailer }));

    const result = await executor.execute(input(EMAIL_TO_ADDRESS));

    expect(result.status).toBe('done');
    expect(mailer.sendEmail).toHaveBeenCalledWith({
      to: 'ops@example.com',
      subject: 'Order ol_order_1',
      text: 'Automation Notify ops fired for ol_order_1.',
    });
  });

  it('should fail naming the missing binding when no mailer is wired into this process', async () => {
    // The worker has no MAILER_TOKEN today; the operator must be able to tell
    // that apart from a bounced email.
    const executor = new SendEmailExecutorService(stubResolver({}));
    const result = await executor.execute(input(EMAIL_TO_ADDRESS));
    expect(result.status).toBe('failed');
    expect(result.detail).toContain('email sender');
  });

  it('should send to the buyer address from the order snapshot', async () => {
    const recipients: string[] = [];
    const mailer = {
      sendEmail: (message: { to: string }) => {
        recipients.push(message.to);
        return Promise.resolve();
      },
    };
    const orders = {
      getOrderRecord: jest.fn().mockResolvedValue({
        buyerEmail: 'buyer@example.com', placedAt: null, dispatchByAt: null,
      }),
    };
    const executor = new SendEmailExecutorService(
      stubResolver({ MAILER_TOKEN: mailer, ORDER_RECORD_SERVICE_TOKEN: orders }),
    );

    const result = await executor.execute(input(EMAIL_TO_BUYER));

    expect(result.status).toBe('done');
    expect(recipients).toEqual(['buyer@example.com']);
  });

  it('should FAIL rather than silently skip when no buyer email is stored', async () => {
    const mailer = { sendEmail: jest.fn() };
    const orders = { getOrderRecord: jest.fn().mockResolvedValue({ placedAt: null, dispatchByAt: null }) };
    const executor = new SendEmailExecutorService(
      stubResolver({ MAILER_TOKEN: mailer, ORDER_RECORD_SERVICE_TOKEN: orders }),
    );

    const result = await executor.execute(input(EMAIL_TO_BUYER));

    expect(result.status).toBe('failed');
    expect(result.detail).toContain('buyer email');
    expect(mailer.sendEmail).not.toHaveBeenCalled();
  });

  it('should still send to a fixed address when the order read fails', async () => {
    const mailer = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    const orders = { getOrderRecord: jest.fn().mockRejectedValue(new Error('db down')) };
    const executor = new SendEmailExecutorService(
      stubResolver({ MAILER_TOKEN: mailer, ORDER_RECORD_SERVICE_TOKEN: orders }),
    );

    const result = await executor.execute(input(EMAIL_TO_ADDRESS));

    expect(result.status).toBe('done');
  });

  it('should fail (not throw) when the mailer throws', async () => {
    const mailer = { sendEmail: jest.fn().mockRejectedValue(new Error('smtp down')) };
    const executor = new SendEmailExecutorService(stubResolver({ MAILER_TOKEN: mailer }));
    const result = await executor.execute(input(EMAIL_TO_ADDRESS));
    expect(result.status).toBe('failed');
    expect(result.detail).toContain('smtp down');
  });
});

describe('AutomationActionExecutorRegistry', () => {
  const registry = new AutomationActionExecutorRegistry(
    new RelayStatusToSourceExecutorService(stubResolver({})),
    new SendEmailExecutorService(stubResolver({})),
    new UnavailableActionExecutorService(),
  );

  it('should cover every declared action', () => {
    expect([...registry.coveredActions()].sort()).toEqual([...AutomationActionValues].sort());
    for (const action of AutomationActionValues) {
      expect(registry.resolve(action)).toBeDefined();
    }
  });

  it('should not mention any of the four pruned actions', () => {
    for (const pruned of ['mark-packed', 'propose-credit-note', 'adjust-stock', 'call-a-webhook']) {
      expect(registry.coveredActions()).not.toContain(pruned);
    }
  });
});
