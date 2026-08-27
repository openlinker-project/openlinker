/**
 * Composer tests (#2365)
 *
 * The fixture matrix is deliberately ASYMMETRIC — `order.packed` allows two
 * actions, `return.received` allows one — so a test that passes only because
 * every action is legal everywhere cannot pass here.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders, sampleConnection } from '../../../test/test-utils';
import {
  AutomationComposerDialog,
  seedActions,
  selectCarrierConnections,
} from './automation-composer-dialog';
import { AUTOMATION_COMPOSER_COPY } from '../lib/automation.copy';
import type { AutomationVocabulary } from '../api/automation.types';
import type { Connection } from '../../connections';

const VOCABULARY: AutomationVocabulary = {
  triggers: [
    {
      value: 'order.packed',
      firingMode: 'edge',
      configKey: null,
      legalActions: ['relay-status-to-source', 'dispatch-shipment'],
      legalConditionFields: ['sourceConnection', 'orderCountry', 'orderTotalGross'],
    },
    {
      value: 'return.received',
      firingMode: 'edge',
      configKey: null,
      legalActions: ['send-email'],
      legalConditionFields: ['sourceConnection'],
    },
    {
      value: 'order.on_hold_for',
      firingMode: 'deadline-sweep',
      configKey: 'withinHours',
      legalActions: ['send-email'],
      legalConditionFields: ['holdReason'],
    },
  ],
  actions: [
    {
      action: 'relay-status-to-source',
      availability: 'available',
      reason: null,
      irreversible: false,
    },
    {
      action: 'dispatch-shipment',
      availability: 'unavailable',
      reason: 'Buying a shipping label from an automation is not built yet.',
      irreversible: true,
    },
    {
      action: 'send-email',
      availability: 'partial',
      reason: 'Automation emails currently require the API process.',
      irreversible: false,
    },
  ],
  conditionFields: [],
  amountOps: ['gte', 'lt'],
  holdReasons: ['awaiting-payment', 'address-problem'],
  stepBounds: { min: 1, max: 3 },
  runOutcomes: [],
  stepStatuses: [],
  nonFiringReasons: [],
  conditionOutcomes: [],
};

function renderComposer(
  overrides: Partial<Parameters<typeof AutomationComposerDialog>[0]> = {},
): void {
  renderWithProviders(
    <AutomationComposerDialog
      open
      onOpenChange={vi.fn()}
      trigger="order.packed"
      vocabulary={VOCABULARY}
      {...overrides}
    />,
  );
}

describe('AutomationComposerDialog', () => {
  it('should offer only the actions legal for the selected trigger', async () => {
    renderComposer();

    const select = await screen.findByLabelText(AUTOMATION_COMPOSER_COPY.actionLabel);
    const options = within(select).getAllByRole('option').map((option) => option.textContent);

    expect(options).toHaveLength(2);
    expect(options).toContain('Tell the marketplace');
    expect(options).toContain('Buy the shipping label');
    // Legal for `return.received`, never for `order.packed`.
    expect(options).not.toContain('Send an email');
  });

  it('should offer a different action set for a different trigger, from the same fixture', async () => {
    renderComposer({ trigger: 'return.received' });

    const select = await screen.findByLabelText(AUTOMATION_COMPOSER_COPY.actionLabel);
    const options = within(select).getAllByRole('option').map((option) => option.textContent);

    expect(options).toEqual(['Send an email']);
  });

  it('should offer only the condition fields legal for the selected trigger', async () => {
    const user = userEvent.setup();
    renderComposer();

    // The composer opens with no conditions — "act on every one" is the default.
    await user.click(
      await screen.findByRole('button', { name: AUTOMATION_COMPOSER_COPY.addCondition }),
    );

    const fieldSelect = screen.getByLabelText(AUTOMATION_COMPOSER_COPY.conditionFieldLabel);
    const options = within(fieldSelect).getAllByRole('option').map((o) => o.textContent);

    expect(options).toEqual([
      'The order came from',
      'The delivery country is',
      'The order total (gross)',
    ]);
    // Legal for `order.on_hold_for`, never for `order.packed`.
    expect(options).not.toContain('The hold reason is');
  });

  it('should render the non-retroactivity sentence verbatim', async () => {
    renderComposer();
    expect(
      await screen.findByText('An automation only acts on things that happen after you save it.'),
    ).toBeInTheDocument();
  });

  it('should state stop-on-first-failure once, for the rule', async () => {
    renderComposer();
    const matches = await screen.findAllByText(/Steps run in order/);
    // A property of the rule, not of any step — repeating it per row would
    // state N times something true once.
    expect(matches).toHaveLength(1);
  });

  it('should cap the action list at the cap the API reported', async () => {
    const user = userEvent.setup();
    renderComposer();

    const addStep = await screen.findByRole('button', { name: AUTOMATION_COMPOSER_COPY.addAction });
    await user.click(addStep);
    await user.click(addStep);

    // Seeded 1 + 2 added === the fixture's stepBounds.max of 3.
    expect(addStep).toBeDisabled();
  });

  it('should carry an availability badge and the backend reason on an offered action', async () => {
    renderComposer({ prefillSuggested: true });

    // A2 is legal here and offered, but cannot run — offered, never ready.
    expect(await screen.findByText('Not built yet')).toBeInTheDocument();
    expect(
      screen.getByText('Buying a shipping label from an automation is not built yet.'),
    ).toBeInTheDocument();
  });

  it('should render no priority field', async () => {
    renderComposer();
    await screen.findByText(AUTOMATION_COMPOSER_COPY.thenLabel);
    expect(screen.queryByLabelText(/priority/i)).toBeNull();
  });

  it('should add and remove condition rows', async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(await screen.findByRole('button', { name: AUTOMATION_COMPOSER_COPY.addCondition }));
    expect(screen.getByLabelText(AUTOMATION_COMPOSER_COPY.conditionFieldLabel)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Remove condition 1/ }));
    expect(screen.queryByLabelText(AUTOMATION_COMPOSER_COPY.conditionFieldLabel)).toBeNull();
  });

  it('should render the trigger config input only where the vocabulary declares a key', async () => {
    renderComposer({ trigger: 'order.on_hold_for' });
    expect(
      await screen.findByLabelText(AUTOMATION_COMPOSER_COPY.triggerConfigLabel),
    ).toBeInTheDocument();
  });

  it('should not render a trigger config input for a parameterless trigger', async () => {
    renderComposer();
    await screen.findByText(AUTOMATION_COMPOSER_COPY.whenLabel);
    expect(screen.queryByLabelText(AUTOMATION_COMPOSER_COPY.triggerConfigLabel)).toBeNull();
  });
});

describe('AutomationComposerDialog — typing', () => {
  it('should keep every character typed into a condition value', async () => {
    // Regression: writing rows through `useFieldArray.update()` regenerated the
    // row key, remounted the subtree and swallowed the keystroke — a probe
    // typing "PL" produced "". Leaf inputs are `register`ed for this reason.
    const user = userEvent.setup();
    renderComposer();

    await user.click(
      await screen.findByRole('button', { name: AUTOMATION_COMPOSER_COPY.addCondition }),
    );
    await user.selectOptions(
      screen.getByLabelText(AUTOMATION_COMPOSER_COPY.conditionFieldLabel),
      'orderCountry',
    );

    const value = screen.getByLabelText(AUTOMATION_COMPOSER_COPY.conditionValueLabel);
    await user.type(value, 'PL');

    expect(value).toHaveValue('PL');
  });

  it('should keep every character typed into an amount', async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(
      await screen.findByRole('button', { name: AUTOMATION_COMPOSER_COPY.addCondition }),
    );
    await user.selectOptions(
      screen.getByLabelText(AUTOMATION_COMPOSER_COPY.conditionFieldLabel),
      'orderTotalGross',
    );

    const amount = screen.getByLabelText(AUTOMATION_COMPOSER_COPY.amountLabel);
    await user.type(amount, '2000.50');

    expect(amount).toHaveValue('2000.50');
  });

  it('should keep every character typed into the rule name', async () => {
    const user = userEvent.setup();
    renderComposer();

    const name = await screen.findByLabelText(AUTOMATION_COMPOSER_COPY.nameLabel);
    await user.type(name, 'Tell the marketplace');

    expect(name).toHaveValue('Tell the marketplace');
  });

  it('should clear the value slot when the condition field changes', async () => {
    // The old value belongs to a different comparison; submitting it under the
    // new field would send a stale value the operator never chose.
    const user = userEvent.setup();
    renderComposer();

    await user.click(
      await screen.findByRole('button', { name: AUTOMATION_COMPOSER_COPY.addCondition }),
    );
    const fieldSelect = screen.getByLabelText(AUTOMATION_COMPOSER_COPY.conditionFieldLabel);
    await user.selectOptions(fieldSelect, 'orderCountry');
    await user.type(screen.getByLabelText(AUTOMATION_COMPOSER_COPY.conditionValueLabel), 'PL');

    await user.selectOptions(fieldSelect, 'sourceConnection');

    expect(screen.getByLabelText(AUTOMATION_COMPOSER_COPY.conditionValueLabel)).toHaveValue('');
  });

  it('should append a merge field to the email body', async () => {
    const user = userEvent.setup();
    renderComposer({ trigger: 'return.received' });

    const body = await screen.findByLabelText(AUTOMATION_COMPOSER_COPY.bodyLabel);
    await user.type(body, 'Order ');
    await user.click(screen.getByRole('button', { name: '{order.reference}' }));

    expect(body).toHaveValue('Order {order.reference}');
  });
});

describe('seedActions', () => {
  it('should seed the suggested pair when the matrix allows both', () => {
    expect(
      seedActions(['relay-status-to-source', 'dispatch-shipment'], true).map((a) => a.action),
    ).toEqual(['dispatch-shipment', 'relay-status-to-source']);
  });

  it('should drop a suggested step the matrix forbids rather than submit an illegal pair', () => {
    expect(seedActions(['relay-status-to-source'], true).map((a) => a.action)).toEqual([
      'relay-status-to-source',
    ]);
  });

  it('should never seed an empty step list, which the server refuses', () => {
    expect(seedActions(['send-email'], true)).toHaveLength(1);
    expect(seedActions([], false)).toHaveLength(1);
  });

  it('should fall back to a legal action when the default is not legal here', () => {
    expect(seedActions(['send-email'], false)[0].action).toBe('send-email');
  });
});

describe('selectCarrierConnections', () => {
  const carrier: Connection = {
    ...sampleConnection,
    id: 'conn-inpost',
    name: 'InPost',
    status: 'active',
    enabledCapabilities: ['ShippingProviderManager'],
  };

  it('should select only active connections carrying the shipping capability', () => {
    const other: Connection = {
      ...sampleConnection,
      id: 'conn-allegro',
      enabledCapabilities: ['OfferManager'],
    };
    expect(selectCarrierConnections([carrier, other]).map((c) => c.id)).toEqual(['conn-inpost']);
  });

  it('should exclude a disabled carrier connection', () => {
    expect(selectCarrierConnections([{ ...carrier, status: 'disabled' }])).toHaveLength(0);
  });
});
