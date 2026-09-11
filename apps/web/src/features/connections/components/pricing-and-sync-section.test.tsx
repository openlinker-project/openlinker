import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  renderWithProviders,
  createMockApiClient,
  createAuthenticatedSessionAdapter,
} from '../../../test/test-utils';
import { PricingAndSyncSection } from './pricing-and-sync-section';
import type { ConnectionPricingSyncView } from '../../price-changes';

function buildView(overrides: Partial<ConnectionPricingSyncView> = {}): ConnectionPricingSyncView {
  return {
    default: { mode: 'manual', rule: { type: 'margin', percent: 22, rounding: 'endingIn99' } },
    sources: [
      {
        sourceConnectionId: 'src-1',
        sourceLabel: 'PrestaShop — Main Store',
        isCustomOverride: false,
        effective: { mode: 'manual', rule: { type: 'margin', percent: 22, rounding: 'endingIn99' } },
        openEpisodeCount: 3,
      },
    ],
    ...overrides,
  };
}

// `renderWithProviders` defaults to `createNoopSessionAdapter()` (an
// UNAUTHENTICATED session), never the admin fixture — every test exercising
// the editable path must pass this explicitly, or `useWriteAccess`'s
// `canWrite` reads false and every control renders disabled by design
// (#3166 review, finding 3).
const ADMIN_SESSION = createAuthenticatedSessionAdapter();

const VIEWER_SESSION = createAuthenticatedSessionAdapter({
  id: 'u2',
  username: 'viewer',
  email: null,
  role: 'viewer',
  permissions: ['connections:read'],
});

const OPERATOR_SESSION = createAuthenticatedSessionAdapter({
  id: 'u3',
  username: 'operator',
  email: null,
  role: 'operator',
  permissions: ['connections:read', 'listings:write'],
});

describe('PricingAndSyncSection', () => {
  it('renders the default rule sentence and every known source, override or not', async () => {
    const apiClient = createMockApiClient({
      pricingSync: { get: vi.fn().mockResolvedValue(buildView()) },
    });

    renderWithProviders(<PricingAndSyncSection connectionId="dest-1" />, {
      apiClient,
      sessionAdapter: ADMIN_SESSION,
    });

    expect(await screen.findByText(/keep a 22% margin/, { selector: '#conn-rule-note' })).toBeInTheDocument();
    expect(screen.getByText('PrestaShop — Main Store')).toBeInTheDocument();
    expect(screen.getByText(/using the default rule/)).toBeInTheDocument();
  });

  it('flips the mode switch, shows the unsaved bar, and saves both default + overrides in one call', async () => {
    const savedView = buildView({
      default: { mode: 'automatic', rule: { type: 'margin', percent: 22, rounding: 'endingIn99' } },
    });
    const update = vi.fn().mockResolvedValue(savedView);
    // The successful save invalidates the GET query, which refetches — GET
    // must agree with what UPDATE persisted or the section's own post-save
    // reseed (#3166 review, finding 3) races a refetch reporting the STALE
    // pre-save default, producing a false "unsaved changes" flash that is an
    // artifact of the mock, not of the component.
    const get = vi.fn().mockResolvedValueOnce(buildView()).mockResolvedValue(savedView);
    const apiClient = createMockApiClient({
      pricingSync: { get, update },
    });

    renderWithProviders(<PricingAndSyncSection connectionId="dest-1" />, {
      apiClient,
      sessionAdapter: ADMIN_SESSION,
    });
    await screen.findByText(/keep a 22% margin/, { selector: '#conn-rule-note' });

    expect(screen.queryByText("You've changed something and haven't saved it yet.")).not.toBeInTheDocument();

    const defaultGroup = screen.getByRole('radiogroup', { name: 'Default price sync mode' });
    await userEvent.click(within(defaultGroup).getByRole('radio', { name: 'Automatic' }));
    expect(await screen.findByText("You've changed something and haven't saved it yet.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('dest-1', {
        default: { mode: 'automatic', rule: { type: 'margin', percent: 22, rounding: 'endingIn99' } },
        sourceOverrides: {},
      });
    });

    // The unsaved bar clears on a SUCCESSFUL save (#3166 review, finding 3) —
    // re-seeded from the mutation's own response rather than compared against
    // the stale pre-save query snapshot.
    await waitFor(() => {
      expect(
        screen.queryByText("You've changed something and haven't saved it yet."),
      ).not.toBeInTheDocument();
    });
  });

  it('discards local changes back to the last-fetched state', async () => {
    const apiClient = createMockApiClient({
      pricingSync: { get: vi.fn().mockResolvedValue(buildView()) },
    });

    renderWithProviders(<PricingAndSyncSection connectionId="dest-1" />, {
      apiClient,
      sessionAdapter: ADMIN_SESSION,
    });
    await screen.findByText(/keep a 22% margin/, { selector: '#conn-rule-note' });

    const defaultGroup = screen.getByRole('radiogroup', { name: 'Default price sync mode' });
    await userEvent.click(within(defaultGroup).getByRole('radio', { name: 'Automatic' }));
    expect(await screen.findByText("You've changed something and haven't saved it yet.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));

    await waitFor(() => {
      expect(
        screen.queryByText("You've changed something and haven't saved it yet."),
      ).not.toBeInTheDocument();
    });
    expect(within(defaultGroup).getByRole('radio', { name: 'Manual review' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('toggling a source override on copies from the default; toggling it back off asks before dropping it', async () => {
    // A stateful fake, not two independently-scripted `mockResolvedValue`
    // canned responses — a successful save invalidates the GET query, which
    // refetches, so GET and UPDATE must agree on what was actually persisted
    // or the section's own post-save reseed (#3166 review, finding 3) races
    // a refetch reporting the PRE-save state, producing a false "unsaved
    // changes" flash that is an artifact of the mock, not of the component.
    let serverState = buildView();
    const get = vi.fn(() => Promise.resolve(serverState));
    const update = vi.fn((_connectionId: string, input: { default: unknown; sourceOverrides: Record<string, unknown> }) => {
      serverState = {
        default: input.default as ConnectionPricingSyncView['default'],
        sources: serverState.sources.map((s) => ({
          ...s,
          isCustomOverride: s.sourceConnectionId in input.sourceOverrides,
          effective:
            (input.sourceOverrides[s.sourceConnectionId] as ConnectionPricingSyncView['default'] | undefined) ??
            (input.default as ConnectionPricingSyncView['default']),
        })),
      };
      return Promise.resolve(serverState);
    });
    const apiClient = createMockApiClient({
      pricingSync: { get, update },
    });

    renderWithProviders(<PricingAndSyncSection connectionId="dest-1" />, {
      apiClient,
      sessionAdapter: ADMIN_SESSION,
    });
    await screen.findByText('PrestaShop — Main Store');

    await userEvent.click(screen.getByTestId('source-custom-toggle'));

    // Copied from the current default (margin/22/endingIn99), so the summary
    // no longer reads "using the default rule".
    expect(screen.queryByText(/using the default rule/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('dest-1', {
        default: { mode: 'manual', rule: { type: 'margin', percent: 22, rounding: 'endingIn99' } },
        sourceOverrides: {
          'src-1': { mode: 'manual', rule: { type: 'margin', percent: 22, rounding: 'endingIn99' } },
        },
      });
    });

    // Toggling back off displays the default rule again (never the stale
    // about-to-be-discarded override, #3166 review finding 4) ...
    await userEvent.click(screen.getByTestId('source-custom-toggle'));
    expect(await screen.findByText(/using the default rule/)).toBeInTheDocument();

    // ... and Save on a PERSISTED override refuses to silently drop it.
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText(/Saving will permanently remove the custom rule/),
    ).toBeInTheDocument();
    expect(update).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Discard and save' }));
    await waitFor(() => {
      expect(update).toHaveBeenLastCalledWith(
        'dest-1',
        expect.objectContaining({ sourceOverrides: {} }),
      );
    });
  });

  it('links the pending-changes count to the Price changes tab pre-filtered to this connection, pluralized correctly', async () => {
    const apiClient = createMockApiClient({
      pricingSync: { get: vi.fn().mockResolvedValue(buildView()) },
    });

    renderWithProviders(<PricingAndSyncSection connectionId="dest-1" />, {
      apiClient,
      sessionAdapter: ADMIN_SESSION,
    });

    expect(await screen.findByText('3 changes waiting')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'review them' })).toHaveAttribute(
      'href',
      '/listings?view=queue&queueConn=dest-1',
    );
  });

  it('states "1 change", not "1 changes", for a single pending change', async () => {
    const apiClient = createMockApiClient({
      pricingSync: {
        get: vi.fn().mockResolvedValue(buildView({
          sources: [
            {
              sourceConnectionId: 'src-1',
              sourceLabel: 'PrestaShop — Main Store',
              isCustomOverride: false,
              effective: { mode: 'manual', rule: { type: 'margin', percent: 22, rounding: 'endingIn99' } },
              openEpisodeCount: 1,
            },
          ],
        })),
      },
    });

    renderWithProviders(<PricingAndSyncSection connectionId="dest-1" />, {
      apiClient,
      sessionAdapter: ADMIN_SESSION,
    });
    expect(await screen.findByText('1 change waiting')).toBeInTheDocument();
  });

  describe('margin validation (#3166 review, finding 2)', () => {
    it('refuses to save a margin of 100% or more, matching the server-side ceiling', async () => {
      const update = vi.fn();
      const apiClient = createMockApiClient({
        pricingSync: { get: vi.fn().mockResolvedValue(buildView()), update },
      });

      renderWithProviders(<PricingAndSyncSection connectionId="dest-1" />, {
      apiClient,
      sessionAdapter: ADMIN_SESSION,
    });
      await userEvent.click(await screen.findByRole('button', { name: 'Edit default rule' }));

      const percentInput = screen.getByLabelText('Percent');
      await userEvent.clear(percentInput);
      await userEvent.type(percentInput, '150');

      expect(
        await screen.findByText(/A margin must be below 100%/),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
      expect(update).not.toHaveBeenCalled();
    });

    it('accepts and types a decimal percentage without erasing the decimal point', async () => {
      const apiClient = createMockApiClient({
        pricingSync: { get: vi.fn().mockResolvedValue(buildView()) },
      });

      renderWithProviders(<PricingAndSyncSection connectionId="dest-1" />, {
      apiClient,
      sessionAdapter: ADMIN_SESSION,
    });
      await userEvent.click(await screen.findByRole('button', { name: 'Edit default rule' }));

      const percentInput = screen.getByLabelText('Percent');
      await userEvent.clear(percentInput);
      await userEvent.type(percentInput, '22.5');

      expect(percentInput).toHaveValue('22.5');
    });
  });

  describe('write access (#3166 review, finding 3)', () => {
    it('disables every editable control for a viewer, who can still see the settings', async () => {
      const apiClient = createMockApiClient({
        pricingSync: { get: vi.fn().mockResolvedValue(buildView()) },
      });

      renderWithProviders(<PricingAndSyncSection connectionId="dest-1" />, {
        apiClient,
        sessionAdapter: VIEWER_SESSION,
      });

      expect(await screen.findByText(/keep a 22% margin/, { selector: '#conn-rule-note' })).toBeInTheDocument();
      const defaultGroup = screen.getByRole('radiogroup', { name: 'Default price sync mode' });
      for (const radio of within(defaultGroup).getAllByRole('radio')) {
        expect(radio).toBeDisabled();
      }
      expect(screen.getByRole('button', { name: 'Edit default rule' })).toBeDisabled();
      expect(screen.getByTestId('source-custom-toggle')).toBeDisabled();
    });

    it('disables every editable control for an operator too — the PATCH is admin-only', async () => {
      const apiClient = createMockApiClient({
        pricingSync: { get: vi.fn().mockResolvedValue(buildView()) },
      });

      renderWithProviders(<PricingAndSyncSection connectionId="dest-1" />, {
        apiClient,
        sessionAdapter: OPERATOR_SESSION,
      });

      expect(await screen.findByText(/keep a 22% margin/, { selector: '#conn-rule-note' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit default rule' })).toBeDisabled();
    });
  });

  it('never renders a loading-flash error state on a successful load (#3166 review, finding 6)', async () => {
    const apiClient = createMockApiClient({
      pricingSync: { get: vi.fn().mockResolvedValue(buildView()) },
    });

    renderWithProviders(<PricingAndSyncSection connectionId="dest-1" />, {
      apiClient,
      sessionAdapter: ADMIN_SESSION,
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(await screen.findByText(/keep a 22% margin/, { selector: '#conn-rule-note' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  describe('initialExpandSourceId deep-link pre-expand (#3167 review, finding 1)', () => {
    it('pre-checks the named source and copies the default rule in as its starting point', async () => {
      const apiClient = createMockApiClient({
        pricingSync: { get: vi.fn().mockResolvedValue(buildView()) },
      });

      renderWithProviders(
        <PricingAndSyncSection connectionId="dest-1" initialExpandSourceId="src-1" />,
        { apiClient, sessionAdapter: ADMIN_SESSION },
      );

      const checkbox = await screen.findByTestId('source-custom-toggle');
      expect(checkbox).toBeChecked();
      // Enabling the override is precisely the state change a manual
      // checkbox click makes, so it correctly leaves Save enabled — the
      // finding 1 regression was that NEITHER this pre-expand NOR a manual
      // click could ever enable Save (`isDirty` ignored `customSources`
      // entirely). That the button is enabled here proves the fix, not a
      // no-unsaved-changes claim.
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    });

    it('scrolls the pre-expanded row into view once it renders', async () => {
      const apiClient = createMockApiClient({
        pricingSync: { get: vi.fn().mockResolvedValue(buildView()) },
      });
      const scrollIntoViewMock = vi.fn();
      // jsdom doesn't implement `scrollIntoView` at all.
      window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

      renderWithProviders(
        <PricingAndSyncSection connectionId="dest-1" initialExpandSourceId="src-1" />,
        { apiClient, sessionAdapter: ADMIN_SESSION },
      );

      await screen.findByTestId('source-custom-toggle');
      await waitFor(() => {
        expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
      });
    });

    it('reports rather than silently dropping a source id absent from the data', async () => {
      const apiClient = createMockApiClient({
        pricingSync: { get: vi.fn().mockResolvedValue(buildView()) },
      });

      renderWithProviders(
        <PricingAndSyncSection connectionId="dest-1" initialExpandSourceId="src-does-not-exist" />,
        { apiClient, sessionAdapter: ADMIN_SESSION },
      );

      expect(await screen.findByText(/isn't one of this connection's current sources/)).toBeInTheDocument();
      // And nothing was spuriously pre-selected.
      expect(screen.getByTestId('source-custom-toggle')).not.toBeChecked();
    });
  });
});
