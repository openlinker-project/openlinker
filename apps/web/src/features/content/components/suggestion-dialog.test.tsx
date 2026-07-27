/**
 * Suggestion Dialog — Unit Tests
 *
 * Verifies the generate → apply flow, the "not auto-saved" contract (Apply
 * just calls `onApply(text)` — persistence is the parent's job), that
 * tone/extra inputs are forwarded as part of the suggest request payload,
 * and that the trigger is gated on the `ai:suggest` permission via the
 * `useWriteAccess` + `ReadOnlyLock` pattern (#1668): visible-but-disabled
 * for a demo viewer, hidden for a genuinely unauthorized non-demo session.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SuggestionDialog } from './suggestion-dialog';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import type { SessionUser } from '../../../shared/auth/session.types';
import type { SuggestionResponse } from '../api/content.types';

const viewerUser: SessionUser = {
  id: 'user_viewer',
  username: 'viewer',
  email: 'viewer@example.com',
  role: 'viewer',
  permissions: [
    'connections:read',
    'sync:read',
    'integrations:read',
    'adapters:read',
    'orders:read',
    'products:read',
    'inventory:read',
    'listings:read',
  ],
};

function makeSuggestionResponse(suggestion: string): SuggestionResponse {
  return {
    suggestion,
    requestId: 'req_1',
    templateKey: 'offer.description.suggest',
    templateVersion: 1,
    templateChannel: null,
    modelUsed: 'fake',
    latencyMs: 12,
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
  };
}

/**
 * Session hydration is async (`SessionProvider` starts anonymous, then
 * resolves the adapter's session in an effect) — same reason the trigger
 * initially renders locked before flipping to enabled for an admin session.
 * Wait for the enabled state before interacting, mirroring the pattern the
 * permission-gating tests below use for the disabled state.
 */
async function waitForEnabledTrigger(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Suggest with AI/ })).toBeEnabled(),
  );
}

describe('SuggestionDialog', () => {
  afterEach(cleanup);

  it('opens the dialog when the trigger is clicked', async () => {
    const mockApi = createMockApiClient();
    renderWithProviders(
      <SuggestionDialog productId="ol_product_1" channel={null} onApply={vi.fn()} />,
      { apiClient: mockApi, sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    const user = userEvent.setup();
    await waitForEnabledTrigger();
    await user.click(screen.getByRole('button', { name: /Suggest with AI/ }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Generate a draft for the/)).toBeInTheDocument();
  });

  it('forwards tone + extra instructions to the suggest API and previews the result', async () => {
    const suggest = vi
      .fn()
      .mockResolvedValue(makeSuggestionResponse('A concise product description.'));
    const mockApi = createMockApiClient({ content: { suggest } });
    const onApply = vi.fn();

    renderWithProviders(
      <SuggestionDialog productId="ol_product_1" channel="allegro" onApply={onApply} />,
      { apiClient: mockApi, sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    const user = userEvent.setup();
    await waitForEnabledTrigger();
    await user.click(screen.getByRole('button', { name: /Suggest with AI/ }));
    const dialog = await screen.findByRole('dialog');
    const within_ = within(dialog);

    await user.type(within_.getByLabelText('Tone'), 'confident');
    await user.type(within_.getByLabelText('Extra instructions'), 'mention warranty');
    await user.click(within_.getByRole('button', { name: 'Generate' }));

    expect(await within_.findByText('A concise product description.')).toBeInTheDocument();
    expect(suggest).toHaveBeenCalledWith('ol_product_1', {
      channel: 'allegro',
      tone: 'confident',
      extraInstructions: 'mention warranty',
    });
    // onApply must not fire until the operator explicitly applies.
    expect(onApply).not.toHaveBeenCalled();
  });

  it('calls onApply with the suggestion when the operator clicks "Apply to editor"', async () => {
    const suggest = vi.fn().mockResolvedValue(makeSuggestionResponse('Generated text'));
    const mockApi = createMockApiClient({ content: { suggest } });
    const onApply = vi.fn();

    renderWithProviders(
      <SuggestionDialog productId="ol_product_1" channel={null} onApply={onApply} />,
      { apiClient: mockApi, sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    const user = userEvent.setup();
    await waitForEnabledTrigger();
    await user.click(screen.getByRole('button', { name: /Suggest with AI/ }));
    const dialog = await screen.findByRole('dialog');
    const within_ = within(dialog);

    await user.click(within_.getByRole('button', { name: 'Generate' }));
    await within_.findByText('Generated text');
    await user.click(within_.getByRole('button', { name: 'Apply to editor' }));

    expect(onApply).toHaveBeenCalledWith('Generated text');
  });

  it('renders a deep link to /ai/prompt-templates when the suggest API returns a 404 missing-template error (#490)', async () => {
    const suggest = vi.fn().mockRejectedValue(
      new ApiError(
        'Prompt template not found: key=offer.description.suggest, channel=master, version=1. ' +
          'Seed a template with channel=null for this key, or use a channel-specific template.',
        404,
        { statusCode: 404, message: 'Prompt template not found: ...' },
      ),
    );
    const mockApi = createMockApiClient({ content: { suggest } });

    renderWithProviders(
      <SuggestionDialog productId="ol_product_1" channel={null} onApply={vi.fn()} />,
      { apiClient: mockApi, sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    const user = userEvent.setup();
    await waitForEnabledTrigger();
    await user.click(screen.getByRole('button', { name: /Suggest with AI/ }));
    const dialog = await screen.findByRole('dialog');
    const within_ = within(dialog);

    await user.click(within_.getByRole('button', { name: 'Generate' }));

    // The error body shows up inside the dialog's Alert.
    expect(
      await within_.findByText(/Prompt template not found/),
    ).toBeInTheDocument();
    // And it carries the actionable deep link to the admin UI.
    const deepLink = within_.getByRole('link', { name: /Open prompt templates/ });
    expect(deepLink).toHaveAttribute('href', '/ai/prompt-templates');
  });

  it('does not render the deep link for unrelated errors', async () => {
    const suggest = vi
      .fn()
      .mockRejectedValue(new ApiError('Server exploded', 500, { statusCode: 500 }));
    const mockApi = createMockApiClient({ content: { suggest } });

    renderWithProviders(
      <SuggestionDialog productId="ol_product_1" channel={null} onApply={vi.fn()} />,
      { apiClient: mockApi, sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    const user = userEvent.setup();
    await waitForEnabledTrigger();
    await user.click(screen.getByRole('button', { name: /Suggest with AI/ }));
    const dialog = await screen.findByRole('dialog');
    const within_ = within(dialog);

    await user.click(within_.getByRole('button', { name: 'Generate' }));

    expect(await within_.findByText('Server exploded')).toBeInTheDocument();
    expect(within_.queryByRole('link', { name: /Open prompt templates/ })).toBeNull();
  });

  it('omits empty tone and extraInstructions from the request payload', async () => {
    const suggest = vi.fn().mockResolvedValue(makeSuggestionResponse(''));
    const mockApi = createMockApiClient({ content: { suggest } });

    renderWithProviders(
      <SuggestionDialog productId="ol_product_1" channel={null} onApply={vi.fn()} />,
      { apiClient: mockApi, sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    const user = userEvent.setup();
    await waitForEnabledTrigger();
    await user.click(screen.getByRole('button', { name: /Suggest with AI/ }));
    const dialog = await screen.findByRole('dialog');
    const within_ = within(dialog);
    await user.click(within_.getByRole('button', { name: 'Generate' }));

    expect(suggest).toHaveBeenCalledWith('ol_product_1', {
      channel: null,
      tone: undefined,
      extraInstructions: undefined,
    });
  });

  describe('permission gating (ai:suggest, useWriteAccess + ReadOnlyLock, #1668)', () => {
    it('hides the trigger entirely for a genuinely unauthorized non-demo session', async () => {
      const suggest = vi.fn();
      const mockApi = createMockApiClient({ content: { suggest } });
      renderWithProviders(
        <SuggestionDialog productId="ol_product_1" channel={null} onApply={vi.fn()} />,
        { apiClient: mockApi, sessionAdapter: createAuthenticatedSessionAdapter(viewerUser) },
      );

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /Suggest with AI/ })).not.toBeInTheDocument();
      });
      expect(suggest).not.toHaveBeenCalled();
    });

    it('renders the trigger visible-but-disabled with the demo read-only tooltip for a demo viewer', async () => {
      const suggest = vi.fn();
      const mockApi = createMockApiClient({
        system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) },
        content: { suggest },
      });
      renderWithProviders(
        <SuggestionDialog productId="ol_product_1" channel={null} onApply={vi.fn()} />,
        { apiClient: mockApi, sessionAdapter: createAuthenticatedSessionAdapter(viewerUser) },
      );

      const user = userEvent.setup();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Suggest with AI/ })).toBeDisabled(),
      );

      await user.click(screen.getByRole('button', { name: /Suggest with AI/ }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(suggest).not.toHaveBeenCalled();

      const trigger = screen.getByRole('button', { name: /Suggest with AI/ });
      await user.hover(trigger.parentElement as HTMLElement);

      // Radix renders the tooltip copy twice (visible content + a visually
      // hidden `role="tooltip"` a11y duplicate) — `findByText` would match
      // both and throw. Query the unique `role="tooltip"` node instead.
      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip).toHaveTextContent(DEMO_READ_ONLY_ACTION_MESSAGE);
    });

    it('keeps the trigger enabled for an admin session even when the deployment is in demo mode', async () => {
      const suggest = vi.fn().mockResolvedValue(makeSuggestionResponse('ok'));
      const mockApi = createMockApiClient({
        system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) },
        content: { suggest },
      });
      renderWithProviders(
        <SuggestionDialog productId="ol_product_1" channel={null} onApply={vi.fn()} />,
        { apiClient: mockApi, sessionAdapter: createAuthenticatedSessionAdapter() },
      );

      await waitForEnabledTrigger();
    });
  });
});
