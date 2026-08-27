/**
 * AutomationRulesList tests (#2364)
 *
 * The behaviours these cover are the ones an operator is harmed by if they
 * regress: a rule that cannot act must say so, a read-only session must see no
 * write control, disarming must stay one click, and arming a money rule must
 * not be one.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { AutomationRulesList } from './automation-rules-list';
import type { AutomationRule } from '../api/automation.types';

const baseRule: AutomationRule = {
  id: 'rule-1',
  name: 'Tell the marketplace when packed',
  trigger: 'order.packed',
  triggerConfig: {},
  conditions: [],
  actions: [{ action: 'relay-status-to-source' }],
  definitionHash: 'hash-1',
  isActive: true,
  effectiveFrom: '2026-08-01T00:00:00.000Z',
  effectiveTo: null,
  hasIrreversibleAction: false,
  actionAvailability: [
    { action: 'relay-status-to-source', availability: 'available', reason: null },
  ],
  moneyAckByUserId: null,
  moneyAckAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const LABEL_REASON =
  'Buying a shipping label from an automation needs a recipient and parcel that cannot be derived from a stored order.';

const blockedRule: AutomationRule = {
  ...baseRule,
  id: 'rule-2',
  name: 'Buy a label when packed',
  isActive: false,
  hasIrreversibleAction: true,
  actions: [{ action: 'dispatch-shipment' }],
  actionAvailability: [
    { action: 'dispatch-shipment', availability: 'unavailable', reason: LABEL_REASON },
  ],
};

function renderList(overrides: Partial<Parameters<typeof AutomationRulesList>[0]> = {}): {
  onSetActive: ReturnType<typeof vi.fn>;
} {
  const onSetActive = vi.fn();
  renderWithProviders(
    <AutomationRulesList
      rules={[baseRule]}
      canWrite
      readOnlyLocked={false}
      readOnlyMessage="Read only"
      firingsUnrecorded={false}
      onSetActive={onSetActive}
      pendingRuleId={null}
      writeError={null}
      {...overrides}
    />,
  );
  return { onSetActive };
}

describe('AutomationRulesList', () => {
  it('should warn that a rule cannot act when a step is unavailable, quoting the reason', async () => {
    renderList({ rules: [blockedRule] });

    expect(await screen.findByText('This rule cannot act yet')).toBeInTheDocument();
    // The BACKEND's sentence, verbatim — never paraphrased, or the composer and
    // a failed run would say different things about the same action.
    expect(screen.getByText(new RegExp(LABEL_REASON.slice(0, 40)))).toBeInTheDocument();
  });

  it('should not warn about a rule whose every step is available', () => {
    renderList();
    expect(screen.queryByText('This rule cannot act yet')).toBeNull();
  });

  it('should disarm in one click, without a confirmation step', async () => {
    const user = userEvent.setup();
    const { onSetActive } = renderList();

    await user.click(screen.getByRole('button', { name: 'Turn off' }));

    // A disarmed rule spends nothing, so there is nothing to consent to — the
    // acknowledgement argument is not passed at all, rather than passed empty.
    expect(onSetActive).toHaveBeenCalledWith(baseRule, false);
  });

  it('should promise that turning a rule off keeps what it has already done', () => {
    renderList();
    expect(
      screen.getByText('Turning a rule off keeps everything it has already done.'),
    ).toBeInTheDocument();
  });

  it('should require an acknowledgement before arming a rule that spends money', async () => {
    const user = userEvent.setup();
    const { onSetActive } = renderList({ rules: [blockedRule] });

    await user.click(screen.getByRole('button', { name: 'Turn on' }));

    // Not armed yet — the backend refuses this write without the flag anyway.
    expect(onSetActive).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'I understand — turn it on' }));
    expect(onSetActive).toHaveBeenCalledWith(blockedRule, true, true);
  });

  it('should show a read-only session the rules and no write control', () => {
    renderList({ canWrite: false, readOnlyLocked: false });

    expect(screen.getByText('Tell the marketplace when packed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull();
    expect(
      screen.getByText('Your account can look at automations but not change them.'),
    ).toBeInTheDocument();
  });

  it('should say it cannot tell whether a rule matched while firings are unrecorded', () => {
    renderList({ firingsUnrecorded: true });

    // Never "this rule has never matched" — an empty log with recording off is
    // not evidence of anything.
    expect(
      screen.getByText(
        'OpenLinker cannot yet tell you whether this rule has ever matched an order.',
      ),
    ).toBeInTheDocument();
  });

  it('should state the unrecorded-firings fact once for the whole list, not once per rule', () => {
    renderList({ rules: [baseRule, blockedRule], firingsUnrecorded: true });

    // Whether firings are recorded is a property of the BUILD, so repeating it
    // on every row would state N times something true once.
    expect(
      screen.getAllByText(
        'OpenLinker cannot yet tell you whether this rule has ever matched an order.',
      ),
    ).toHaveLength(1);
  });

  it('should surface a failed write instead of silently reverting', () => {
    renderList({ writeError: 'Arming this rule needs an explicit acknowledgement.' });
    expect(screen.getByText('The change was not saved')).toBeInTheDocument();
  });

  it('should render an empty state when the trigger has no rules', () => {
    renderList({ rules: [] });
    expect(screen.getByText('No rules for this event yet')).toBeInTheDocument();
  });
});
