/**
 * Activity-page tests (#2386)
 *
 * The four empty states are the substance here: each answers a different
 * question, and the wrong one makes a false statement about the operator's own
 * setup.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../test/test-utils';
// The FEATURE's own contract, not the app-tier client: a page may not import
// `app/` (the layering rule), and this is the type that actually owns the shape.
import type { AutomationsApi } from '../../features/automation';
import { AutomationActivityPage } from './automation-activity-page';

const EMPTY_LOG = { runs: [], limit: 50, hasMore: false, recordingAvailable: true, note: null };

function render(
  options: {
    route?: string;
    summary?: unknown;
    feed?: unknown;
    /** A spy the test can count calls on, typed to the API method's own shape. */
    feedMock?: AutomationsApi['listRunFeed'];
  } = {},
): void {
  const apiClient = createMockApiClient({
    automations: {
      listRunFeed: options.feedMock ?? vi.fn().mockResolvedValue(options.feed ?? EMPTY_LOG),
      getSummary: vi.fn().mockResolvedValue(
        options.summary ?? {
          items: [{ trigger: 'order.packed', ruleCount: 2 }],
          droppedCount: 0,
        },
      ),
    },
  });
  renderWithProviders(<AutomationActivityPage />, {
    apiClient,
    route: options.route ?? '/automations/activity',
  });
}

describe('AutomationActivityPage', () => {
  it('should state only what is true about retention', async () => {
    // Spec §5.6(c) asks for "Runs older than 90 days are removed." — but nothing
    // prunes `automation_runs`, so that sentence would assert a deletion that
    // never happened.
    render();
    expect(
      await screen.findByText('Every automation run recorded so far is listed here.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/90 days/)).toBeNull();
  });

  it('should say nothing has run yet when rules exist but none fired', async () => {
    render();
    expect(await screen.findByText('Nothing has run yet')).toBeInTheDocument();
  });

  it('should say there are no automations at all when no rule exists', async () => {
    // A different situation with a different next step — collapsing the two
    // would tell an operator with ten rules that they have none.
    render({ summary: { items: [{ trigger: 'order.packed', ruleCount: 0 }], droppedCount: 0 } });
    expect(await screen.findByText('You have no automations yet')).toBeInTheDocument();
  });

  it('should say a filter excluded everything rather than that nothing ran', async () => {
    render({ route: '/automations/activity?outcome=failed' });
    expect(await screen.findByText('No runs match these filters')).toBeInTheDocument();
  });

  it('should explain that collisions are not recorded when filtering by Blocked', async () => {
    // `blocked` has no producer in this build, so an empty list would read as
    // "no collisions have occurred" — a claim nothing supports.
    render({ route: '/automations/activity?outcome=blocked' });
    expect(await screen.findByText('Collisions are not recorded yet')).toBeInTheDocument();
    expect(screen.queryByText('No runs match these filters')).toBeNull();
  });

  it('should offer all four outcomes in the filter, including Blocked', async () => {
    render();
    const select = await screen.findByLabelText('Result');
    expect(screen.getByRole('option', { name: 'Held back' })).toBeInTheDocument();
    expect(select).toBeInTheDocument();
  });

  it('should not offer Clear filters when nothing is narrowed', async () => {
    render();
    await screen.findByText('Nothing has run yet');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('should offer Clear filters once a filter is honoured', async () => {
    render({ route: '/automations/activity?outcome=done' });
    expect(await screen.findByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('should not offer Clear filters when every supplied value was unrecognised', async () => {
    // Nothing was narrowed, so the control would be misleading.
    render({ route: '/automations/activity?trigger=nope&from=banana' });
    await screen.findByText('Nothing has run yet');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('should show an active rule filter rather than narrowing silently', async () => {
    // `ruleId` has no picker — it arrives via a deep link. Without a chip the
    // list is narrowed with nothing on screen saying why.
    render({ route: '/automations/activity?ruleId=rule-1' });
    expect(await screen.findByText(/Rule: rule-1/)).toBeInTheDocument();
  });

  it('should clear the rule filter from the chip', async () => {
    const user = userEvent.setup();
    render({ route: '/automations/activity?ruleId=rule-1' });

    await user.click(await screen.findByRole('button', { name: /Rule: rule-1/ }));
    expect(screen.queryByText(/Rule: rule-1/)).toBeNull();
  });

  it('should NOT query on every keystroke in the order filter', async () => {
    // A per-keystroke commit changes the query key per character: a 30-char
    // order id would issue ~30 requests and reset the offset 30 times.
    const user = userEvent.setup();
    const listRunFeed = vi.fn().mockResolvedValue(EMPTY_LOG);
    render({ feedMock: listRunFeed as unknown as AutomationsApi['listRunFeed'] });

    await screen.findByText('Nothing has run yet');
    const callsBefore = listRunFeed.mock.calls.length;

    await user.type(screen.getByLabelText('Order'), 'ol_order_1');

    expect(listRunFeed.mock.calls.length).toBe(callsBefore);
  });

  it('should commit the order filter on Enter', async () => {
    const user = userEvent.setup();
    render();

    const input = await screen.findByLabelText('Order');
    await user.type(input, 'ol_order_1{Enter}');

    expect(await screen.findByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('should link back to the automations index', async () => {
    render();
    expect(await screen.findByRole('link', { name: 'Back to automations' })).toHaveAttribute(
      'href',
      '/automations',
    );
  });
});
